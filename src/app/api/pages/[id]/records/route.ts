import { and, asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseRecords, databases, pageRecordLinks, pages } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();
const linkSchema = z.object({ recordId: z.string().uuid() });

const recordColumns = {
  id: databaseRecords.id,
  title: databaseRecords.title,
  databaseId: databases.id,
  databaseName: databases.name,
};

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  try {
    const [page] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, id), isNull(pages.deletedAt)))
      .limit(1);
    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const [linked, all] = await Promise.all([
      db
        .select(recordColumns)
        .from(pageRecordLinks)
        .innerJoin(databaseRecords, eq(pageRecordLinks.recordId, databaseRecords.id))
        .innerJoin(databases, eq(databaseRecords.databaseId, databases.id))
        .where(eq(pageRecordLinks.pageId, id))
        .orderBy(asc(databases.name), asc(databaseRecords.title)),
      db
        .select(recordColumns)
        .from(databaseRecords)
        .innerJoin(databases, eq(databaseRecords.databaseId, databases.id))
        .orderBy(asc(databases.name), asc(databaseRecords.title)),
    ]);

    const linkedIds = new Set(linked.map((record) => record.id));
    return NextResponse.json({
      records: linked,
      options: all.filter((record) => !linkedIds.has(record.id)),
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to load page records", error, { status: 500, logMessage: "Failed to load page records:" });
  }
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }
  const parsed = linkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid record" }, { status: 400 });
  }

  try {
    const [page] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, id), isNull(pages.deletedAt)))
      .limit(1);
    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const [record] = await db
      .select({ id: databaseRecords.id, pageId: databaseRecords.pageId })
      .from(databaseRecords)
      .where(eq(databaseRecords.id, parsed.data.recordId))
      .limit(1);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    if (record.pageId === id) {
      return NextResponse.json(
        { error: "A page cannot link to the record it belongs to" },
        { status: 400 },
      );
    }

    await db
      .insert(pageRecordLinks)
      .values({ pageId: id, recordId: record.id })
      .onConflictDoNothing();

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to link a record", error, { status: 500, logMessage: "Failed to link a record:" });
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }
  const parsed = linkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid record" }, { status: 400 });
  }

  try {
    await db
      .delete(pageRecordLinks)
      .where(
        and(
          eq(pageRecordLinks.pageId, id),
          eq(pageRecordLinks.recordId, parsed.data.recordId),
        ),
      );
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to unlink a record", error, { status: 500, logMessage: "Failed to unlink a record:" });
  }
}
