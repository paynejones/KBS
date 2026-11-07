import { and, asc, eq, inArray, isNull, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseProperties, databaseRecordRelations, databaseRecords, databases, pages } from "@/db/schema";
import { missingAttachmentIds } from "@/lib/attachment-store";
import { referencedAttachmentIds, validateDatabaseRecordValues } from "@/lib/database-values";
import { apiErrorResponse } from "@/lib/api-log";

type Context = { params: Promise<{ id: string; recordId: string }> };
const recordSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  pageId: z.string().uuid().nullable().optional(),
  relations: z.record(z.string().uuid(), z.array(z.string().uuid())).optional(),
}).refine((data) => Object.keys(data).length > 0);

export async function GET(request: Request, context: Context) {
  const { id, recordId } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(recordId).success) {
    return NextResponse.json({ error: "Invalid record ID" }, { status: 400 });
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [record] = await tx.select().from(databaseRecords)
        .where(and(eq(databaseRecords.id, recordId), eq(databaseRecords.databaseId, id)))
        .limit(1);
      if (!record) return { error: "Record not found", status: 404 as const };
      const [database] = await tx.select({ id: databases.id, name: databases.name })
        .from(databases).where(eq(databases.id, id)).limit(1);
      if (!database) return { error: "Database not found", status: 404 as const };

      // Older records can predate linked pages. Opening one creates the page so
      // every record presents properties and content together.
      let pageId = record.pageId;
      const [linkedPage] = pageId
        ? await tx.select({ id: pages.id }).from(pages)
            .where(and(eq(pages.id, pageId), isNull(pages.deletedAt))).limit(1)
        : [];
      if (!linkedPage) {
        const [pageOrder] = await tx.select({ value: max(pages.sortOrder) })
          .from(pages).where(isNull(pages.parentId));
        const [page] = await tx.insert(pages).values({
          title: record.title,
          sortOrder: (pageOrder?.value ?? -1) + 1,
        }).returning({ id: pages.id });
        pageId = page.id;
        await tx.update(databaseRecords).set({ pageId, updatedAt: new Date() })
          .where(eq(databaseRecords.id, recordId));
      }

      const properties = await tx.select().from(databaseProperties)
        .where(eq(databaseProperties.databaseId, id)).orderBy(asc(databaseProperties.sortOrder));
      const relationRows = await tx.select().from(databaseRecordRelations)
        .where(eq(databaseRecordRelations.sourceRecordId, recordId));
      const relations: Record<string, string[]> = {};
      for (const relation of relationRows) {
        relations[relation.propertyId] = [
          ...(relations[relation.propertyId] ?? []),
          relation.targetRecordId,
        ];
      }
      return { record: { ...record, pageId }, properties, relations, database };
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({
      ...result.record,
      relations: result.relations,
      properties: result.properties,
      database: result.database,
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to load database record", error, { status: 500, logMessage: "Failed to load database record:" });
  }
}

export async function PATCH(request: Request, context: Context) {
  const { id, recordId } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(recordId).success) {
    return NextResponse.json({ error: "Invalid record ID" }, { status: 400 });
  }
  const parsed = recordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid record update" }, { status: 400 });
  try {
    const [existingRecord] = await db.select({ id: databaseRecords.id, pageId: databaseRecords.pageId })
      .from(databaseRecords)
      .where(and(eq(databaseRecords.id, recordId), eq(databaseRecords.databaseId, id)))
      .limit(1);
    if (!existingRecord) return NextResponse.json({ error: "Record not found" }, { status: 404 });

    if (parsed.data.values) {
      const valuePropertyIds = Object.keys(parsed.data.values);
      if (valuePropertyIds.some((propertyId) => !z.string().uuid().safeParse(propertyId).success)) {
        return NextResponse.json({ error: "Invalid property ID in record values" }, { status: 400 });
      }
      const valueProperties = valuePropertyIds.length > 0
        ? await db.select().from(databaseProperties).where(and(
            eq(databaseProperties.databaseId, id),
            inArray(databaseProperties.id, valuePropertyIds),
          ))
        : [];
      const valueError = validateDatabaseRecordValues(parsed.data.values, valueProperties);
      if (valueError) return NextResponse.json({ error: valueError }, { status: 400 });
      const missing = await missingAttachmentIds(referencedAttachmentIds(parsed.data.values, valueProperties));
      if (missing.length > 0) return NextResponse.json({ error: "A file value points to a missing attachment." }, { status: 400 });
    }

    if (parsed.data.pageId) {
      const [page] = await db.select({ id: pages.id }).from(pages).where(eq(pages.id, parsed.data.pageId)).limit(1);
      if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const validatedRelations: { propertyId: string; targetRecordIds: string[] }[] = [];
    for (const [propertyId, requestedIds] of Object.entries(parsed.data.relations ?? {})) {
      const [property] = await db.select().from(databaseProperties)
        .where(and(eq(databaseProperties.id, propertyId), eq(databaseProperties.databaseId, id)))
        .limit(1);
      if (!property || property.type !== "relation") {
        return NextResponse.json({ error: "Invalid relation property" }, { status: 400 });
      }
      const targetDatabaseId = property.options.relatedDatabaseId;
      if (typeof targetDatabaseId !== "string") {
        return NextResponse.json({ error: "Relation has no target database" }, { status: 400 });
      }
      const targetRecordIds = Array.from(new Set(requestedIds));
      if (targetRecordIds.length > 0) {
        const targetRecords = await db.select({ id: databaseRecords.id }).from(databaseRecords)
          .where(and(eq(databaseRecords.databaseId, targetDatabaseId), inArray(databaseRecords.id, targetRecordIds)));
        if (targetRecords.length !== targetRecordIds.length) {
          return NextResponse.json({ error: "A related record was not found in the selected database" }, { status: 400 });
        }
      }
      validatedRelations.push({ propertyId, targetRecordIds });
    }

    const recordFields = {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.values !== undefined ? { values: parsed.data.values } : {}),
      ...(parsed.data.pageId !== undefined ? { pageId: parsed.data.pageId } : {}),
    };
    await db.transaction(async (tx) => {
      if (Object.keys(recordFields).length > 0) {
        await tx.update(databaseRecords)
          .set({ ...recordFields, updatedAt: new Date() })
          .where(and(eq(databaseRecords.id, recordId), eq(databaseRecords.databaseId, id)));
      }
      // The record is the title source for its full page.
      if (recordFields.title !== undefined && existingRecord.pageId) {
        await tx.update(pages)
          .set({ title: recordFields.title, updatedAt: new Date() })
          .where(eq(pages.id, existingRecord.pageId));
      }
      for (const relation of validatedRelations) {
        await tx.delete(databaseRecordRelations).where(and(
          eq(databaseRecordRelations.sourceRecordId, recordId),
          eq(databaseRecordRelations.propertyId, relation.propertyId),
        ));
        if (relation.targetRecordIds.length > 0) {
          await tx.insert(databaseRecordRelations).values(relation.targetRecordIds.map((targetRecordId) => ({
            sourceRecordId: recordId,
            propertyId: relation.propertyId,
            targetRecordId,
          })));
        }
      }
    });
    const [record] = await db.select().from(databaseRecords).where(eq(databaseRecords.id, recordId)).limit(1);
    const existingRelations = await db.select().from(databaseRecordRelations).where(eq(databaseRecordRelations.sourceRecordId, recordId));
    const relationMap: Record<string, string[]> = {};
    for (const relation of existingRelations) {
      relationMap[relation.propertyId] = [...(relationMap[relation.propertyId] ?? []), relation.targetRecordId];
    }
    return NextResponse.json({ ...record, relations: relationMap });
  } catch (error) {
    return apiErrorResponse(request, "Failed to update database record", error, { status: 500, logMessage: "Failed to update database record:" });
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id, recordId } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(recordId).success) {
    return NextResponse.json({ error: "Invalid record ID" }, { status: 400 });
  }
  try {
    const [record] = await db.delete(databaseRecords)
      .where(and(eq(databaseRecords.id, recordId), eq(databaseRecords.databaseId, id)))
      .returning({ id: databaseRecords.id });
    if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to delete database record", error, { status: 500, logMessage: "Failed to delete database record:" });
  }
}
