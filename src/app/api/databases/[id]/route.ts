import { and, eq, asc, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databases, databaseProperties, databaseRecords, databaseRecordRelations, databaseTemplates, databaseViews, pages } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();
const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
}).refine((data) => Object.keys(data).length > 0);

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid database ID" }, { status: 400 });
  try {
    const [database] = await db.select().from(databases).where(eq(databases.id, id)).limit(1);
    if (!database) return NextResponse.json({ error: "Database not found" }, { status: 404 });
    const [properties, records, views, templates] = await Promise.all([
      db.select().from(databaseProperties).where(eq(databaseProperties.databaseId, id)).orderBy(asc(databaseProperties.sortOrder)),
      db.select().from(databaseRecords).where(eq(databaseRecords.databaseId, id)).orderBy(asc(databaseRecords.sortOrder)),
      db.select().from(databaseViews).where(eq(databaseViews.databaseId, id)).orderBy(asc(databaseViews.sortOrder)),
      db.select().from(databaseTemplates).where(eq(databaseTemplates.databaseId, id)).orderBy(asc(databaseTemplates.name)),
    ]);
    const relationRows = records.length
      ? await db.select().from(databaseRecordRelations).where(inArray(databaseRecordRelations.sourceRecordId, records.map((record) => record.id)))
      : [];
    const relationsByRecord = new Map<string, Record<string, string[]>>();
    for (const relation of relationRows) {
      const recordRelations = relationsByRecord.get(relation.sourceRecordId) ?? {};
      recordRelations[relation.propertyId] = [
        ...(recordRelations[relation.propertyId] ?? []),
        relation.targetRecordId,
      ];
      relationsByRecord.set(relation.sourceRecordId, recordRelations);
    }
    const pageIds = Array.from(new Set(records.flatMap((record) => record.pageId ? [record.pageId] : [])));
    const pageCovers = pageIds.length
      ? await db.select({ id: pages.id, coverImageUrl: pages.coverImageUrl })
          .from(pages)
          .where(and(inArray(pages.id, pageIds), isNull(pages.deletedAt)))
      : [];
    const pageCoverById = new Map(pageCovers.map((page) => [page.id, page.coverImageUrl]));
    const recordsWithRelations = records.map((record) => ({
      ...record,
      pageCoverImageUrl: record.pageId ? pageCoverById.get(record.pageId) ?? null : null,
      relations: relationsByRecord.get(record.id) ?? {},
    }));
    return NextResponse.json({ ...database, properties, records: recordsWithRelations, views, templates });
  } catch (error) {
    return apiErrorResponse(request, "Failed to load database", error, { status: 500, logMessage: "Failed to load database:" });
  }
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid database ID" }, { status: 400 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid database update" }, { status: 400 });
  try {
    const [database] = await db.update(databases).set({ ...parsed.data, updatedAt: new Date() }).where(eq(databases.id, id)).returning();
    if (!database) return NextResponse.json({ error: "Database not found" }, { status: 404 });
    return NextResponse.json(database);
  } catch (error) {
    return apiErrorResponse(request, "Failed to update database", error, { status: 500, logMessage: "Failed to update database:" });
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid database ID" }, { status: 400 });
  try {
    const [database] = await db.delete(databases).where(eq(databases.id, id)).returning({ id: databases.id });
    if (!database) return NextResponse.json({ error: "Database not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to delete database", error, { status: 500, logMessage: "Failed to delete database:" });
  }
}
