import { and, asc, eq, isNull, notExists } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseRecords, pageRecordLinks, pages } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

type Context = { params: Promise<{ recordId: string }> };
const idSchema = z.string().uuid();
const linkSchema = z.object({ pageId: z.string().uuid() });

/**
 * Pages a record is connected to. The rows are the same ones the page-side
 * panel writes, so a connection made from either side appears on both.
 */
export async function GET(request: Request, context: Context) {
  const { recordId } = await context.params;
  if (!idSchema.safeParse(recordId).success) {
    return NextResponse.json({ error: "Invalid record ID" }, { status: 400 });
  }

  try {
    const [record] = await db
      .select({ id: databaseRecords.id, pageId: databaseRecords.pageId })
      .from(databaseRecords)
      .where(eq(databaseRecords.id, recordId))
      .limit(1);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    const [linked, all] = await Promise.all([
      db
        .select({ id: pages.id, title: pages.title })
        .from(pageRecordLinks)
        .innerJoin(pages, eq(pageRecordLinks.pageId, pages.id))
        .where(and(eq(pageRecordLinks.recordId, recordId), isNull(pages.deletedAt)))
        .orderBy(asc(pages.title)),
      db
        .select({ id: pages.id, title: pages.title })
        .from(pages)
        .where(
          and(
            isNull(pages.deletedAt),
            eq(pages.isInbox, false),
            // Record pages are their own records; linking them here would
            // connect a record to another record through a page.
            notExists(
              db
                .select({ id: databaseRecords.id })
                .from(databaseRecords)
                .where(eq(databaseRecords.pageId, pages.id)),
            ),
          ),
        )
        .orderBy(asc(pages.title)),
    ]);

    const linkedIds = new Set(linked.map((page) => page.id));
    return NextResponse.json({
      pages: linked,
      options: all.filter((page) => !linkedIds.has(page.id) && page.id !== record.pageId),
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to load record pages", error, { status: 500, logMessage: "Failed to load record pages:" });
  }
}

export async function POST(request: Request, context: Context) {
  const { recordId } = await context.params;
  if (!idSchema.safeParse(recordId).success) {
    return NextResponse.json({ error: "Invalid record ID" }, { status: 400 });
  }
  const parsed = linkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  }

  try {
    const [record] = await db
      .select({ id: databaseRecords.id, pageId: databaseRecords.pageId })
      .from(databaseRecords)
      .where(eq(databaseRecords.id, recordId))
      .limit(1);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    const [page] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, parsed.data.pageId), isNull(pages.deletedAt)))
      .limit(1);
    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }
    if (record.pageId === page.id) {
      return NextResponse.json(
        { error: "A record cannot link to its own page" },
        { status: 400 },
      );
    }

    await db
      .insert(pageRecordLinks)
      .values({ pageId: page.id, recordId: record.id })
      .onConflictDoNothing();

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to link a page", error, { status: 500, logMessage: "Failed to link a page:" });
  }
}

export async function DELETE(request: Request, context: Context) {
  const { recordId } = await context.params;
  if (!idSchema.safeParse(recordId).success) {
    return NextResponse.json({ error: "Invalid record ID" }, { status: 400 });
  }
  const parsed = linkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  }

  try {
    await db
      .delete(pageRecordLinks)
      .where(
        and(
          eq(pageRecordLinks.recordId, recordId),
          eq(pageRecordLinks.pageId, parsed.data.pageId),
        ),
      );
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to unlink a page", error, { status: 500, logMessage: "Failed to unlink a page:" });
  }
}
