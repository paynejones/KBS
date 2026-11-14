import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseProperties, databaseRecordRelations, databaseRecords, databases, pages } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import {
  buttonExpressionError,
  buttonOptionsSchema,
  evaluateButtonExpression,
  isButtonActionExpression,
  isButtonExpressionWritableProperty,
  isButtonWritableProperty,
  type ButtonAction,
  type ButtonActionLiteral,
  type ButtonActionValue,
  type ButtonRunResult,
} from "@/lib/database-button";
import {
  type CalculationProperty,
  type CalculationRecord,
  type RelationTargetMap,
} from "@/lib/database-calculations";
import { parseFormula } from "@/lib/database-formula";
import { validateDatabaseRecordValues } from "@/lib/database-values";

type Context = { params: Promise<{ id: string; recordId: string }> };
type PropertyRow = typeof databaseProperties.$inferSelect;
type RecordRow = typeof databaseRecords.$inferSelect;

/** An action whose targets are known but whose value is not computed yet. */
type PlannedAction =
  | {
      kind: "property";
      action: Extract<ButtonAction, { type: "set_property" | "set_related_property" }>;
      target: PropertyRow;
      targetRecordIds: string[];
      targetRecords: RecordRow[];
      label: string;
    }
  | {
      kind: "record";
      action: Extract<ButtonAction, { type: "set_record_property" }>;
      target: PropertyRow;
      targetRecord: RecordRow;
      label: string;
    }
  | {
      kind: "create";
      action: Extract<ButtonAction, { type: "create_record" }>;
      targetDatabaseId: string;
      label: string;
    };

/** A planned action whose expression, if it has one, has been computed. */
type ResolvedAction =
  | (Extract<PlannedAction, { kind: "property" }> & { value: ButtonActionLiteral })
  | (Extract<PlannedAction, { kind: "record" }> & { value: ButtonActionLiteral })
  | (Extract<PlannedAction, { kind: "create" }> & { values: Record<string, ButtonActionLiteral> });

type ButtonRunOutcome =
  | { ok: true; results: ButtonRunResult[] }
  | { ok: false; error: string; status: number };

const schema = z.object({
  propertyId: z.string().uuid(),
}).strict();

/** Postgres aborts one of two transactions that lock rows in opposite orders. */
const RETRYABLE_TRANSACTION_CODES = new Set(["40001", "40P01"]);

async function withTransactionRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (attempt >= 2 || typeof code !== "string" || !RETRYABLE_TRANSACTION_CODES.has(code)) {
        throw error;
      }
    }
  }
}

/**
 * Checks a configured value without computing it: a literal is validated
 * against the target property, and an expression is checked for syntax and for
 * the properties it reads. An expression's result is only known once the
 * record's current values are locked.
 */
function plannedValueError(
  raw: ButtonActionValue,
  target: PropertyRow,
  sourceProperties: PropertyRow[],
): string | null {
  if (!isButtonActionExpression(raw)) {
    return validateDatabaseRecordValues({ [target.id]: raw }, [target]);
  }
  if (!isButtonExpressionWritableProperty(target)) {
    return `${target.name} cannot use an expression value`;
  }
  return buttonExpressionError(raw.expression, sourceProperties);
}

/**
 * Turns a configured value into the value that will be written. An expression
 * is computed from the clicked record's locked values, which is what lets
 * `{Count} + 1` raise a counter without the button storing the number.
 * Expressions always read the clicked record, including for actions that write
 * linked records or create a record elsewhere.
 */
/** The record values an expression may read, resolved like a formula's. */
type ExpressionSource = {
  properties: CalculationProperty[];
  record: CalculationRecord;
  targets: RelationTargetMap;
};

function computeActionValue(
  raw: ButtonActionValue,
  target: PropertyRow,
  source: ExpressionSource,
): { value: ButtonActionLiteral } | { error: string } {
  if (!isButtonActionExpression(raw)) {
    const valueError = validateDatabaseRecordValues({ [target.id]: raw }, [target]);
    return valueError ? { error: valueError } : { value: raw };
  }
  if (!isButtonExpressionWritableProperty(target)) {
    return { error: `${target.name} cannot use an expression value` };
  }
  const computed = evaluateButtonExpression(
    raw.expression,
    source.properties,
    source.record,
    source.targets,
  );
  if (!computed.ok) return { error: `${target.name}: ${computed.error}` };
  if (computed.value === null) {
    return {
      error: `${target.name} could not be computed from the current values. Check that every {property} reference holds a number.`,
    };
  }
  const value = target.type === "number" ? computed.value : String(computed.value);
  const valueError = validateDatabaseRecordValues({ [target.id]: value }, [target]);
  return valueError ? { error: valueError } : { value };
}

/**
 * Runs one button property against one record. Targets are resolved first, then
 * one transaction locks every record it may write, computes the values from the
 * locked rows, and writes them together, so a bad action cannot leave half of a
 * button's work behind and two simultaneous clicks cannot lose an increment.
 */
export async function POST(request: Request, context: Context) {
  const { id, recordId } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(recordId).success) {
    return NextResponse.json({ error: "Invalid record ID" }, { status: 400 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid button action" }, { status: 400 });

  try {
    const [record] = await db.select().from(databaseRecords)
      .where(and(eq(databaseRecords.id, recordId), eq(databaseRecords.databaseId, id)))
      .limit(1);
    if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 });

    const properties = await db.select().from(databaseProperties)
      .where(eq(databaseProperties.databaseId, id));
    const button = properties.find((property) => property.id === parsed.data.propertyId);
    if (!button || button.type !== "button") {
      return NextResponse.json({ error: "Button property not found" }, { status: 404 });
    }
    const actions = buttonOptionsSchema.safeParse(button.options);
    if (!actions.success) {
      return NextResponse.json({ error: "This button has no valid actions" }, { status: 400 });
    }

    const propertiesById = new Map(properties.map((property) => [property.id, property]));
    const relationRows = await db.select().from(databaseRecordRelations)
      .where(eq(databaseRecordRelations.sourceRecordId, recordId));
    const propertiesByDatabase = new Map<string, PropertyRow[]>([[id, properties]]);
    const planned: PlannedAction[] = [];

    for (const action of actions.data.actions) {
      if (action.type === "create_record") {
        const [targetDatabase] = await db.select({ id: databases.id, name: databases.name })
          .from(databases).where(eq(databases.id, action.databaseId)).limit(1);
        if (!targetDatabase) {
          return NextResponse.json({ error: "A button action creates a record in a database that does not exist" }, { status: 400 });
        }
        let targetProperties = propertiesByDatabase.get(action.databaseId);
        if (!targetProperties) {
          targetProperties = await db.select().from(databaseProperties)
            .where(eq(databaseProperties.databaseId, action.databaseId));
          propertiesByDatabase.set(action.databaseId, targetProperties);
        }
        const targetById = new Map(targetProperties.map((property) => [property.id, property]));
        for (const [propertyId, rawValue] of Object.entries(action.values)) {
          const target = targetById.get(propertyId);
          if (!target) {
            return NextResponse.json({ error: "A new record value targets a property outside the chosen database" }, { status: 400 });
          }
          if (!isButtonWritableProperty(target)) {
            return NextResponse.json({ error: `${target.name} cannot be set when creating a record` }, { status: 400 });
          }
          const valueError = plannedValueError(rawValue, target, properties);
          if (valueError) return NextResponse.json({ error: valueError }, { status: 400 });
        }
        planned.push({
          kind: "create",
          action,
          targetDatabaseId: action.databaseId,
          label: `New ${targetDatabase.name} record`,
        });
        continue;
      }

      if (action.type === "set_record_property") {
        const [targetDatabase] = await db.select({ id: databases.id }).from(databases)
          .where(eq(databases.id, action.databaseId)).limit(1);
        if (!targetDatabase) {
          return NextResponse.json({ error: "A button action targets a record in a database that does not exist" }, { status: 400 });
        }
        let targetProperties = propertiesByDatabase.get(action.databaseId);
        if (!targetProperties) {
          targetProperties = await db.select().from(databaseProperties)
            .where(eq(databaseProperties.databaseId, action.databaseId));
          propertiesByDatabase.set(action.databaseId, targetProperties);
        }
        const target = targetProperties.find((property) => property.id === action.propertyId);
        if (!target) {
          return NextResponse.json({ error: "A button action targets a property outside the chosen database" }, { status: 400 });
        }
        const [targetRecord] = await db.select().from(databaseRecords)
          .where(and(
            eq(databaseRecords.id, action.recordId),
            eq(databaseRecords.databaseId, action.databaseId),
          ))
          .limit(1);
        if (!targetRecord) {
          return NextResponse.json({ error: "The chosen record no longer exists" }, { status: 400 });
        }
        if (!isButtonWritableProperty(target)) {
          return NextResponse.json({ error: `${target.name} cannot be changed by a button` }, { status: 400 });
        }
        const valueError = plannedValueError(action.value, target, properties);
        if (valueError) return NextResponse.json({ error: valueError }, { status: 400 });
        planned.push({
          kind: "record",
          action,
          target,
          targetRecord,
          label: target.name,
        });
        continue;
      }

      let target: PropertyRow | undefined;
      let targetRecordIds: string[] = [];
      let targetRecords: RecordRow[] = [];
      if (action.type === "set_property") {
        target = propertiesById.get(action.propertyId);
        if (!target) {
          return NextResponse.json({ error: "A button action targets a property outside this database" }, { status: 400 });
        }
        targetRecordIds = [recordId];
        targetRecords = [record];
      } else {
        const relation = propertiesById.get(action.relationPropertyId);
        const targetDatabaseId = relation?.options.relatedDatabaseId;
        if (!relation || relation.type !== "relation" || typeof targetDatabaseId !== "string") {
          return NextResponse.json({ error: "A button action needs a relation from this database" }, { status: 400 });
        }
        let related = propertiesByDatabase.get(targetDatabaseId);
        if (!related) {
          related = await db.select().from(databaseProperties)
            .where(eq(databaseProperties.databaseId, targetDatabaseId));
          propertiesByDatabase.set(targetDatabaseId, related);
        }
        target = related.find((property) => property.id === action.propertyId);
        if (!target) {
          return NextResponse.json({ error: "A button action targets a property outside the related database" }, { status: 400 });
        }
        targetRecordIds = Array.from(new Set(
          relationRows
            .filter((row) => row.propertyId === relation.id)
            .map((row) => row.targetRecordId),
        ));
        if (targetRecordIds.length > 0) {
          targetRecords = await db.select().from(databaseRecords).where(and(
            eq(databaseRecords.databaseId, targetDatabaseId),
            inArray(databaseRecords.id, targetRecordIds),
          ));
          if (targetRecords.length !== targetRecordIds.length) {
            return NextResponse.json({ error: "A linked record no longer exists" }, { status: 409 });
          }
        }
      }

      if (!target) {
        return NextResponse.json({ error: "A button action targets a missing property" }, { status: 400 });
      }
      if (!isButtonWritableProperty(target)) {
        return NextResponse.json({ error: `${target.name} cannot be changed by a button` }, { status: 400 });
      }
      const valueError = plannedValueError(action.value, target, properties);
      if (valueError) return NextResponse.json({ error: valueError }, { status: 400 });

      planned.push({
        kind: "property",
        action,
        target,
        targetRecordIds,
        targetRecords,
        label: target.name,
      });
    }

    const lockIds = new Set<string>([recordId]);
    for (const entry of planned) {
      if (entry.kind === "record") lockIds.add(entry.targetRecord.id);
      if (entry.kind === "property") {
        for (const targetRecord of entry.targetRecords) lockIds.add(targetRecord.id);
      }
    }

    const outcome = await withTransactionRetry<ButtonRunOutcome>(() => db.transaction(async (tx) => {
      // Locking every record this click may write, in ID order, serialises
      // overlapping clicks: the second one waits here and then computes
      // `{Count} + 1` from the number the first one stored.
      const lockedRecords = await tx.select().from(databaseRecords)
        .where(inArray(databaseRecords.id, [...lockIds]))
        .orderBy(databaseRecords.id)
        .for("update");
      const lockedById = new Map(lockedRecords.map((row) => [row.id, row]));
      const lockedRecord = lockedById.get(recordId);
      if (!lockedRecord) {
        return { ok: false as const, error: "Record not found", status: 404 };
      }
      const lockedValues: Record<string, unknown> = {
        ...((lockedRecord.values ?? {}) as Record<string, unknown>),
      };
      // A linked record's stored values come from its locked row too, so a
      // button does not overwrite properties another click just changed.
      const storedValues = (recordRow: RecordRow): Record<string, unknown> => ({
        ...((lockedById.get(recordRow.id)?.values ?? recordRow.values ?? {}) as Record<string, unknown>),
      });

      // An expression reads what a formula reads on this record: its number
      // properties, its rollups, and its formulas. Formulas are expanded into
      // the references they use, so a rollup read only through a formula still
      // has its linked records loaded. Only the rollups that are needed are
      // loaded, from the linked records as they are now.
      const relationsByProperty: Record<string, string[]> = {};
      for (const row of relationRows) {
        relationsByProperty[row.propertyId] = [
          ...(relationsByProperty[row.propertyId] ?? []),
          row.targetRecordId,
        ];
      }
      const referencedNames = new Set<string>();
      const expandReferences = (expression: string) => {
        const parsed = parseFormula(expression);
        if (!parsed.ok) return;
        for (const name of parsed.references) {
          if (referencedNames.has(name)) continue;
          referencedNames.add(name);
          const property = properties.find((candidate) => candidate.name === name);
          if (property?.type !== "formula") continue;
          const nested = property.options.expression;
          if (typeof nested === "string" && nested.trim()) expandReferences(nested);
        }
      };
      for (const entry of planned) {
        const configured = entry.kind === "create"
          ? Object.values(entry.action.values)
          : [entry.action.value];
        for (const value of configured) {
          if (!isButtonActionExpression(value)) continue;
          expandReferences(value.expression);
        }
      }
      const targets: RelationTargetMap = {};
      for (const name of referencedNames) {
        const property = properties.find((candidate) => candidate.name === name);
        if (!property || property.type !== "rollup") continue;
        const relationPropertyId = typeof property.options.relationPropertyId === "string"
          ? property.options.relationPropertyId
          : "";
        if (!relationPropertyId || targets[relationPropertyId]) continue;
        const relation = propertiesById.get(relationPropertyId);
        const targetDatabaseId = relation?.options.relatedDatabaseId;
        if (typeof targetDatabaseId !== "string") continue;
        const targetIds = Array.from(new Set(
          relationRows
            .filter((row) => row.propertyId === relationPropertyId)
            .map((row) => row.targetRecordId),
        ));
        let targetProperties = propertiesByDatabase.get(targetDatabaseId);
        if (!targetProperties) {
          targetProperties = await tx.select().from(databaseProperties)
            .where(eq(databaseProperties.databaseId, targetDatabaseId));
          propertiesByDatabase.set(targetDatabaseId, targetProperties);
        }
        const targetRecords = targetIds.length === 0 ? [] : await tx.select().from(databaseRecords)
          .where(and(
            eq(databaseRecords.databaseId, targetDatabaseId),
            inArray(databaseRecords.id, targetIds),
          ));
        targets[relationPropertyId] = {
          properties: targetProperties as unknown as CalculationProperty[],
          records: targetRecords.map((row) => ({
            id: row.id,
            values: (row.values ?? {}) as Record<string, unknown>,
          })),
        };
      }
      const source: ExpressionSource = {
        properties: properties as unknown as CalculationProperty[],
        record: { values: lockedValues, relations: relationsByProperty },
        targets,
      };

      const resolved: ResolvedAction[] = [];
      for (const entry of planned) {
        if (entry.kind === "create") {
          const targetProperties = propertiesByDatabase.get(entry.action.databaseId) ?? [];
          const values: Record<string, ButtonActionLiteral> = {};
          for (const [propertyId, rawValue] of Object.entries(entry.action.values)) {
            const target = targetProperties.find((property) => property.id === propertyId);
            if (!target) {
              return { ok: false as const, error: "A button action targets a missing property", status: 400 };
            }
            const computed = computeActionValue(rawValue, target, source);
            if ("error" in computed) {
              return { ok: false as const, error: computed.error, status: 400 };
            }
            values[target.id] = computed.value;
          }
          resolved.push({ ...entry, values });
          continue;
        }
        const computed = computeActionValue(entry.action.value, entry.target, source);
        if ("error" in computed) {
          return { ok: false as const, error: computed.error, status: 400 };
        }
        resolved.push({ ...entry, value: computed.value });
      }

      let currentValues = { ...lockedValues };
      let currentChanged = false;
      const relatedUpdates = new Map<string, { databaseId: string; values: Record<string, unknown> }>();
      const results: ButtonRunResult[] = resolved.map((entry, index) => {
        if (entry.kind === "create") {
          return {
            index,
            type: entry.action.type,
            label: entry.label,
            affected: 1,
            createdRecordIds: [],
          };
        }
        if (entry.kind === "record") {
          if (entry.targetRecord.id === recordId) {
            currentValues = { ...currentValues, [entry.target.id]: entry.value };
            currentChanged = true;
          } else {
            const existing = relatedUpdates.get(entry.targetRecord.id)?.values ?? storedValues(entry.targetRecord);
            relatedUpdates.set(entry.targetRecord.id, {
              databaseId: entry.targetRecord.databaseId,
              values: { ...existing, [entry.target.id]: entry.value },
            });
          }
          return {
            index,
            type: entry.action.type,
            label: entry.label,
            affected: 1,
          };
        }
        if (entry.action.type === "set_property") {
          currentValues = { ...currentValues, [entry.target.id]: entry.value };
          currentChanged = true;
        } else {
          for (const targetRecord of entry.targetRecords) {
            const existing = relatedUpdates.get(targetRecord.id)?.values ?? storedValues(targetRecord);
            relatedUpdates.set(targetRecord.id, {
              databaseId: targetRecord.databaseId,
              values: { ...existing, [entry.target.id]: entry.value },
            });
          }
        }
        return {
          index,
          type: entry.action.type,
          label: entry.label,
          affected: entry.targetRecordIds.length,
        };
      });

      if (currentChanged) {
        await tx.update(databaseRecords)
          .set({ values: currentValues, updatedAt: new Date() })
          .where(and(eq(databaseRecords.id, recordId), eq(databaseRecords.databaseId, id)));
      }
      for (const [targetRecordId, update] of relatedUpdates) {
        await tx.update(databaseRecords)
          .set({ values: update.values, updatedAt: new Date() })
          .where(and(
            eq(databaseRecords.id, targetRecordId),
            eq(databaseRecords.databaseId, update.databaseId),
          ));
      }
      for (const [index, entry] of resolved.entries()) {
        if (entry.kind !== "create") continue;
        const [maxOrder] = await tx.select({ value: max(databaseRecords.sortOrder) })
          .from(databaseRecords).where(eq(databaseRecords.databaseId, entry.targetDatabaseId));
        const [pageOrder] = await tx.select({ value: max(pages.sortOrder) })
          .from(pages).where(isNull(pages.parentId));
        const [page] = await tx.insert(pages).values({
          title: entry.action.title,
          sortOrder: (pageOrder?.value ?? -1) + 1,
        }).returning({ id: pages.id });
        const [created] = await tx.insert(databaseRecords).values({
          databaseId: entry.targetDatabaseId,
          pageId: page.id,
          title: entry.action.title,
          values: { ...entry.values },
          sortOrder: (maxOrder?.value ?? -1) + 1,
        }).returning({ id: databaseRecords.id });
        results[index].createdRecordIds?.push(created.id);
      }

      return { ok: true as const, results };
    }));

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }
    const results = outcome.results;

    const [updated] = await db.select().from(databaseRecords)
      .where(eq(databaseRecords.id, recordId)).limit(1);
    const relationMap: Record<string, string[]> = {};
    for (const relation of relationRows) {
      relationMap[relation.propertyId] = [
        ...(relationMap[relation.propertyId] ?? []),
        relation.targetRecordId,
      ];
    }
    const [pageCover] = updated.pageId
      ? await db.select({ coverImageUrl: pages.coverImageUrl }).from(pages)
          .where(eq(pages.id, updated.pageId)).limit(1)
      : [];

    return NextResponse.json({
      record: {
        ...updated,
        pageCoverImageUrl: pageCover?.coverImageUrl ?? null,
      },
      relations: relationMap,
      results,
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to run database button", error, {
      status: 500,
      logMessage: "Failed to run database button:",
    });
  }
}
