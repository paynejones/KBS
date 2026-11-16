import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseProperties } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import { buttonActionSchema } from "@/lib/database-button";
import { MAX_FORMULA_LENGTH, parseFormula } from "@/lib/database-formula";
import {
  MAX_PROPERTY_CHOICES,
  mergePropertyChoices,
  propertyChoices,
  ROLLUP_AGGREGATIONS,
} from "@/lib/database-property";
import { validatePropertyOptions } from "@/lib/database-property-server";

type Context = { params: Promise<{ id: string; propertyId: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  // Choices are append-only: every stored value names its choice, so removing
  // or renaming one would leave rows pointing at a label that no longer exists.
  choices: z.array(z.string().trim().min(1).max(100)).max(MAX_PROPERTY_CHOICES).optional(),
  // A malformed action list is a bad request even when the property does not
  // exist, so it is validated before the row is read.
  actions: z.array(buttonActionSchema).min(1).max(20).optional(),
  expression: z.string().trim().min(1).max(MAX_FORMULA_LENGTH).optional(),
  rollup: z.object({
    relationPropertyId: z.string().uuid(),
    aggregation: z.enum(ROLLUP_AGGREGATIONS),
    targetPropertyId: z.string().uuid().optional(),
  }).strict().optional(),
}).strict().refine(
  (data) => data.name !== undefined
    || data.choices !== undefined
    || data.actions !== undefined
    || data.expression !== undefined
    || data.rollup !== undefined,
  { message: "Provide a setting to update" },
);

async function loadProperty(databaseId: string, propertyId: string) {
  const [property] = await db
    .select()
    .from(databaseProperties)
    .where(and(
      eq(databaseProperties.id, propertyId),
      eq(databaseProperties.databaseId, databaseId),
    ))
    .limit(1);
  return property ?? null;
}

/**
 * Rewrites `{Old name}` references in a formula or a button expression, so a
 * renamed property keeps the calculations and buttons that read it working.
 */
function renameReferences(text: string, from: string, to: string) {
  return text.replace(/\{([^}]*)\}/g, (match, rawName: string) =>
    rawName.trim() === from ? `{${to}}` : match,
  );
}

/** Walks saved button actions and rewrites only their expression values. */
function renameExpressionValues(value: unknown, from: string, to: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => renameExpressionValues(entry, from, to));
  if (!value || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    next[key] = key === "expression" && typeof entry === "string"
      ? renameReferences(entry, from, to)
      : renameExpressionValues(entry, from, to);
  }
  return next;
}

/**
 * True when a saved button action writes to a property: `set_property` and
 * `set_related_property` name one directly, and `create_record` uses property
 * ids as keys of its initial values.
 */
function actionsReferenceProperty(actions: unknown, propertyId: string): boolean {
  if (Array.isArray(actions)) {
    return actions.some((action) => actionsReferenceProperty(action, propertyId));
  }
  if (!actions || typeof actions !== "object") return false;

  const action = actions as Record<string, unknown>;
  if (action.propertyId === propertyId) return true;
  if (action.relationPropertyId === propertyId) return true;
  const values = action.values;
  if (values && typeof values === "object" && !Array.isArray(values)) {
    return propertyId in (values as Record<string, unknown>);
  }
  return false;
}

/**
 * Property settings: button actions, choices on a Select, and the property's
 * name. A rename also updates every formula and button that references the old
 * name, so a rename cannot quietly blank a calculated column.
 */
export async function PATCH(request: Request, context: Context) {
  const { id, propertyId } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(propertyId).success) {
    return NextResponse.json({ error: "Invalid property ID" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid property update" }, { status: 400 });
  }

  try {
    const property = await loadProperty(id, propertyId);
    if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

    let options: Record<string, unknown> = { ...property.options };
    let optionsTouched = false;
    let name = property.name;
    let renamed = false;

    if (parsed.data.actions !== undefined) {
      if (property.type !== "button") {
        return NextResponse.json({ error: "Only button properties have actions" }, { status: 400 });
      }
      options.actions = parsed.data.actions;
      optionsTouched = true;
    }

    if (parsed.data.choices !== undefined) {
      if (property.type !== "select" && property.type !== "multi_select") {
        return NextResponse.json(
          { error: "Only Select and Multi-select properties have choices" },
          { status: 400 },
        );
      }
      const choices = mergePropertyChoices(propertyChoices(property.options), parsed.data.choices);
      if (choices.length > MAX_PROPERTY_CHOICES) {
        return NextResponse.json(
          { error: `A property can offer at most ${MAX_PROPERTY_CHOICES} choices` },
          { status: 400 },
        );
      }
      options.choices = choices;
      optionsTouched = true;
    }

    if (parsed.data.expression !== undefined) {
      if (property.type !== "formula") {
        return NextResponse.json(
          { error: "Only formula properties have an expression" },
          { status: 400 },
        );
      }
      options.expression = parsed.data.expression;
      optionsTouched = true;
    }

    if (parsed.data.rollup !== undefined) {
      if (property.type !== "rollup") {
        return NextResponse.json(
          { error: "Only rollup properties have a calculation" },
          { status: 400 },
        );
      }
      options.relationPropertyId = parsed.data.rollup.relationPropertyId;
      options.aggregation = parsed.data.rollup.aggregation;
      // A count has no number to read, so a leftover target would describe a
      // calculation the rollup does not perform.
      if (parsed.data.rollup.aggregation === "count") delete options.targetPropertyId;
      else if (parsed.data.rollup.targetPropertyId) options.targetPropertyId = parsed.data.rollup.targetPropertyId;
      optionsTouched = true;
    }

    if (optionsTouched) {
      const validated = await validatePropertyOptions(id, property.type, options, property.id);
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: validated.status });
      }
      options = validated.options;
    }

    const nextName = parsed.data.name;
    if (nextName !== undefined && nextName !== property.name) {
      // Formulas and button expressions find properties by `{name}`, so a
      // brace in the new name would leave them unparseable.
      if (/[{}]/.test(nextName)) {
        return NextResponse.json(
          { error: "Property names cannot contain braces, because formulas use {name} references" },
          { status: 400 },
        );
      }
      const siblings = await db
        .select({ id: databaseProperties.id, name: databaseProperties.name })
        .from(databaseProperties)
        .where(eq(databaseProperties.databaseId, id));
      if (siblings.some((sibling) =>
        sibling.id !== property.id && sibling.name.toLowerCase() === nextName.toLowerCase()
      )) {
        return NextResponse.json(
          { error: `“${nextName}” is already used by another property` },
          { status: 400 },
        );
      }
      name = nextName;
      renamed = true;
    }

    const updated = await db.transaction(async (tx) => {
      if (renamed) {
        const formulas = await tx
          .select()
          .from(databaseProperties)
          .where(and(
            eq(databaseProperties.databaseId, id),
            eq(databaseProperties.type, "formula"),
          ));
        for (const formula of formulas) {
          const expression = formula.options.expression;
          if (typeof expression !== "string") continue;
          const rewritten = renameReferences(expression, property.name, name);
          if (rewritten === expression) continue;
          await tx
            .update(databaseProperties)
            .set({ options: { ...formula.options, expression: rewritten } })
            .where(eq(databaseProperties.id, formula.id));
        }

        const buttons = await tx
          .select()
          .from(databaseProperties)
          .where(and(
            eq(databaseProperties.databaseId, id),
            eq(databaseProperties.type, "button"),
          ));
        for (const button of buttons) {
          const actions = button.options.actions;
          if (actions === undefined) continue;
          const rewritten = renameExpressionValues(actions, property.name, name);
          if (JSON.stringify(rewritten) === JSON.stringify(actions)) continue;
          await tx
            .update(databaseProperties)
            .set({ options: { ...button.options, actions: rewritten } })
            .where(eq(databaseProperties.id, button.id));
        }
      }

      const [row] = await tx
        .update(databaseProperties)
        .set({ name, options })
        .where(eq(databaseProperties.id, property.id))
        .returning();
      return row;
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(request, "Failed to update property", error, {
      status: 500,
      logMessage: "Failed to update property:",
    });
  }
}

/**
 * Deletes a property and every record value stored under it. A formula, rollup,
 * or button that depends on the property is refused instead of being left to
 * show a blank column or fail on click.
 */
export async function DELETE(request: Request, context: Context) {
  const { id, propertyId } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(propertyId).success) {
    return NextResponse.json({ error: "Invalid property ID" }, { status: 400 });
  }

  try {
    const property = await loadProperty(id, propertyId);
    if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

    const siblings = await db
      .select()
      .from(databaseProperties)
      .where(eq(databaseProperties.databaseId, id));

    const formula = siblings.find((sibling) => {
      if (sibling.type !== "formula") return false;
      const expression = sibling.options.expression;
      if (typeof expression !== "string") return false;
      const parsed = parseFormula(expression);
      return parsed.ok && parsed.references.includes(property.name);
    });
    if (formula) {
      return NextResponse.json(
        { error: `“${formula.name}” is a formula that reads “${property.name}”. Delete that formula first.` },
        { status: 400 },
      );
    }

    const rollup = siblings.find((sibling) => sibling.type === "rollup"
      && (sibling.options.relationPropertyId === property.id
        || sibling.options.targetPropertyId === property.id));
    if (rollup) {
      return NextResponse.json(
        { error: `“${rollup.name}” is a rollup that uses “${property.name}”. Delete that rollup first.` },
        { status: 400 },
      );
    }

    const button = siblings.find((sibling) => sibling.type === "button"
      && actionsReferenceProperty(sibling.options.actions, property.id));
    if (button) {
      return NextResponse.json(
        { error: `“${button.name}” is a button that writes to “${property.name}”. Delete that button first.` },
        { status: 400 },
      );
    }

    await db.transaction(async (tx) => {
      await tx.delete(databaseProperties).where(eq(databaseProperties.id, property.id));
      // Values live in one JSON object per record, so the column's key has to
      // be removed from every row rather than dropped with the property row.
      await tx.execute(sql`
        update database_records
        set values = values - ${property.id}::text
        where database_id = ${id}::uuid
      `);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to delete property", error, {
      status: 500,
      logMessage: "Failed to delete property:",
    });
  }
}
