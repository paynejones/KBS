import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseProperties, databaseRecordRelations, databaseRecords, databases, pages } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import {
  buttonOptionsSchema,
  isButtonWritableProperty,
  type ButtonAction,
  type ButtonRunResult,
} from "@/lib/database-button";
import { validateDatabaseRecordValues } from "@/lib/database-values";

type Context = { params: Promise<{ id: string; recordId: string }> };
type PropertyRow = typeof databaseProperties.$inferSelect;
type RecordRow = typeof databaseRecords.$inferSelect;
type ResolvedAction =
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

const schema = z.object({
  propertyId: z.string().uuid(),
}).strict();

/**
 * Runs one button property against one record. All targets and values are
 * resolved and validated before a transaction writes anything, so a bad action
 * cannot leave half of a button's work behind.
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
    const resolved: ResolvedAction[] = [];

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
        for (const [propertyId, value] of Object.entries(action.values)) {
          const target = targetById.get(propertyId);
          if (!target) {
            return NextResponse.json({ error: "A new record value targets a property outside the chosen database" }, { status: 400 });
          }
          if (!isButtonWritableProperty(target)) {
            return NextResponse.json({ error: `${target.name} cannot be set when creating a record` }, { status: 400 });
          }
          const valueError = validateDatabaseRecordValues({ [target.id]: value }, [target]);
          if (valueError) return NextResponse.json({ error: valueError }, { status: 400 });
        }
        resolved.push({
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
        const valueError = validateDatabaseRecordValues({ [target.id]: action.value }, [target]);
        if (valueError) return NextResponse.json({ error: valueError }, { status: 400 });
        resolved.push({
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
      const valueError = validateDatabaseRecordValues({ [target.id]: action.value }, [target]);
      if (valueError) return NextResponse.json({ error: valueError }, { status: 400 });

      resolved.push({
        kind: "property",
        action,
        target,
        targetRecordIds,
        targetRecords,
        label: target.name,
      });
    }

    let currentValues = { ...record.values };
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
          currentValues = { ...currentValues, [entry.target.id]: entry.action.value };
          currentChanged = true;
        } else {
          const existing = relatedUpdates.get(entry.targetRecord.id)?.values ?? { ...entry.targetRecord.values };
          relatedUpdates.set(entry.targetRecord.id, {
            databaseId: entry.targetRecord.databaseId,
            values: { ...existing, [entry.target.id]: entry.action.value },
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
        currentValues = { ...currentValues, [entry.target.id]: entry.action.value };
        currentChanged = true;
      } else {
        for (const targetRecord of entry.targetRecords) {
          const existing = relatedUpdates.get(targetRecord.id)?.values ?? { ...targetRecord.values };
          relatedUpdates.set(targetRecord.id, {
            databaseId: targetRecord.databaseId,
            values: { ...existing, [entry.target.id]: entry.action.value },
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

    await db.transaction(async (tx) => {
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
          values: { ...entry.action.values },
          sortOrder: (maxOrder?.value ?? -1) + 1,
        }).returning({ id: databaseRecords.id });
        results[index].createdRecordIds?.push(created.id);
      }
    });

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
