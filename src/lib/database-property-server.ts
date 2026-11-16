import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { databases, databaseProperties } from "@/db/schema";
import { buttonOptionsSchema } from "@/lib/database-button";
import { validateButtonActionDefinitions } from "@/lib/database-button-server";
import {
  formulaReferenceCycle,
  type CalculationProperty,
} from "@/lib/database-calculations";
import { parseFormula } from "@/lib/database-formula";
import { ROLLUP_AGGREGATIONS, type DatabasePropertyType } from "@/lib/database-property";

export type PropertyOptionsValidation =
  | { ok: true; options: Record<string, unknown> }
  | { ok: false; error: string; status: 400 | 404 };

/**
 * Checks the options a property type stores and returns the normalized copy to
 * save. Creating and editing share this, so a formula or rollup obeys the same
 * rules whichever path wrote it.
 */
export async function validatePropertyOptions(
  databaseId: string,
  type: DatabasePropertyType,
  input: Record<string, unknown>,
  /** The property being edited, so a cycle through its new expression is caught. */
  editingPropertyId?: string,
): Promise<PropertyOptionsValidation> {
  if (type === "button") {
    const actions = buttonOptionsSchema.safeParse(input);
    if (!actions.success) {
      return { ok: false, error: "A button needs at least one valid action", status: 400 };
    }
    const actionError = await validateButtonActionDefinitions(databaseId, actions.data.actions);
    if (actionError) return { ok: false, error: actionError, status: 400 };
    return { ok: true, options: { actions: actions.data.actions } };
  }

  if (type === "relation") {
    const relatedDatabaseId = input.relatedDatabaseId;
    if (typeof relatedDatabaseId !== "string" || !z.string().uuid().safeParse(relatedDatabaseId).success) {
      return { ok: false, error: "Choose a database for this relation", status: 400 };
    }
    const [relatedDatabase] = await db
      .select({ id: databases.id })
      .from(databases)
      .where(eq(databases.id, relatedDatabaseId))
      .limit(1);
    if (!relatedDatabase) return { ok: false, error: "Related database not found", status: 404 };
    return { ok: true, options: input };
  }

  if (type === "rollup") {
    const relationPropertyId = input.relationPropertyId;
    const aggregation = input.aggregation;
    if (typeof relationPropertyId !== "string" || !z.string().uuid().safeParse(relationPropertyId).success) {
      return { ok: false, error: "Choose a relation property for this rollup", status: 400 };
    }
    if (!(ROLLUP_AGGREGATIONS as readonly unknown[]).includes(aggregation)) {
      return { ok: false, error: "Invalid rollup calculation", status: 400 };
    }
    // A rollup belongs to a database and aggregates a property of the database
    // its relation points at, so both lookups are checked against the request.
    const [relationProperty] = await db
      .select()
      .from(databaseProperties)
      .where(eq(databaseProperties.id, relationPropertyId))
      .limit(1);
    if (!relationProperty || relationProperty.databaseId !== databaseId || relationProperty.type !== "relation") {
      return { ok: false, error: "Relation property not found", status: 400 };
    }
    if (aggregation !== "count") {
      const targetPropertyId = input.targetPropertyId;
      const relatedDatabaseId = relationProperty.options.relatedDatabaseId;
      if (
        typeof targetPropertyId !== "string"
        || !z.string().uuid().safeParse(targetPropertyId).success
        || typeof relatedDatabaseId !== "string"
      ) {
        return { ok: false, error: "Choose a numeric property to summarize", status: 400 };
      }
      const [targetProperty] = await db
        .select()
        .from(databaseProperties)
        .where(eq(databaseProperties.id, targetPropertyId))
        .limit(1);
      if (
        !targetProperty
        || targetProperty.databaseId !== relatedDatabaseId
        || targetProperty.type !== "number"
      ) {
        return {
          ok: false,
          error: "Rollup calculations require a number property from the related database",
          status: 400,
        };
      }
    }
    return { ok: true, options: input };
  }

  if (type === "formula") {
    const expression = input.expression;
    if (typeof expression !== "string" || !expression.trim()) {
      return { ok: false, error: "Enter a formula", status: 400 };
    }
    const parsedFormula = parseFormula(expression);
    if (!parsedFormula.ok) return { ok: false, error: parsedFormula.error, status: 400 };

    const existingProperties = await db
      .select()
      .from(databaseProperties)
      .where(eq(databaseProperties.databaseId, databaseId));
    const propertiesByName = new Map(existingProperties.map((property) => [property.name, property]));
    for (const reference of parsedFormula.references) {
      const referenced = propertiesByName.get(reference);
      if (!referenced) {
        return { ok: false, error: `No property named “${reference}” in this database`, status: 400 };
      }
      if (referenced.type !== "number" && referenced.type !== "rollup" && referenced.type !== "formula") {
        return {
          ok: false,
          error: "Formulas can reference number, rollup, and formula properties",
          status: 400,
        };
      }
    }
    // A formula may read another formula, so a reference chain could loop back
    // on itself. `referenceValue` would show a cycle as blank, which hides a
    // mistake, so reject it while the formula is still being defined.
    const cycle = formulaReferenceCycle(
      parsedFormula.references,
      existingProperties.map((property) => property.id === editingPropertyId
        ? { ...property, options: { ...property.options, expression } }
        : property) as unknown as CalculationProperty[],
    );
    if (cycle) {
      return { ok: false, error: `Formulas cannot reference themselves: ${cycle}`, status: 400 };
    }
    return { ok: true, options: input };
  }

  return { ok: true, options: input };
}
