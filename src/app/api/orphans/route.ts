import { eq, exists, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  databaseRecordRelations,
  databaseRecords,
  databases,
  pageLinks,
  pageRecordLinks,
  pageTags,
  pages,
} from "@/db/schema";
import { findOrphanPages, findOrphanRecords } from "@/lib/orphans";

function increment(counts: Map<string, number>, id: string) {
  counts.set(id, (counts.get(id) ?? 0) + 1);
}

export async function GET() {
  try {
    const [
      pageRows,
      pageLinkRows,
      recordLinkRows,
      taggedRows,
      recordRows,
      relationRows,
    ] = await Promise.all([
      db
        .select({
          id: pages.id,
          title: pages.title,
          parentId: pages.parentId,
          updatedAt: pages.updatedAt,
          isInbox: pages.isInbox,
          isRecordPage: exists(
            db
              .select({ id: databaseRecords.id })
              .from(databaseRecords)
              .where(eq(databaseRecords.pageId, pages.id)),
          ),
        })
        .from(pages)
        .where(isNull(pages.deletedAt)),
      db
        .select({ sourcePageId: pageLinks.sourcePageId, targetPageId: pageLinks.targetPageId })
        .from(pageLinks),
      db
        .select({ pageId: pageRecordLinks.pageId, recordId: pageRecordLinks.recordId })
        .from(pageRecordLinks),
      db.select({ pageId: pageTags.pageId }).from(pageTags),
      db
        .select({
          id: databaseRecords.id,
          title: databaseRecords.title,
          updatedAt: databaseRecords.updatedAt,
          databaseId: databases.id,
          databaseName: databases.name,
        })
        .from(databaseRecords)
        .innerJoin(databases, eq(databaseRecords.databaseId, databases.id)),
      db
        .select({
          sourceRecordId: databaseRecordRelations.sourceRecordId,
          targetRecordId: databaseRecordRelations.targetRecordId,
        })
        .from(databaseRecordRelations),
    ]);

    const activePageIds = new Set(pageRows.map((page) => page.id));
    const childCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const pageLinkCounts = new Map<string, number>();
    const pageRecordCounts = new Map<string, number>();
    const recordLinkCounts = new Map<string, number>();
    const relationCounts = new Map<string, number>();

    for (const page of pageRows) {
      if (page.parentId && activePageIds.has(page.parentId)) {
        increment(childCounts, page.parentId);
      }
    }
    for (const row of taggedRows) {
      if (activePageIds.has(row.pageId)) increment(tagCounts, row.pageId);
    }
    // A link to or from a trashed page is not a live connection.
    for (const row of pageLinkRows) {
      if (activePageIds.has(row.sourcePageId)) increment(pageLinkCounts, row.sourcePageId);
      if (activePageIds.has(row.targetPageId)) increment(pageLinkCounts, row.targetPageId);
    }
    for (const row of recordLinkRows) {
      if (!activePageIds.has(row.pageId)) continue;
      increment(pageRecordCounts, row.pageId);
      increment(recordLinkCounts, row.recordId);
    }
    for (const row of relationRows) {
      increment(relationCounts, row.sourceRecordId);
      increment(relationCounts, row.targetRecordId);
    }

    const orphanPages = findOrphanPages(
      pageRows
        // Inbox captures are their own queue, and a record's page is the
        // record; neither belongs in a list of unconnected pages.
        .filter((page) => !page.isInbox && !page.isRecordPage)
        .map((page) => ({
          id: page.id,
          title: page.title,
          updatedAt: page.updatedAt,
          parentId: page.parentId,
          childCount: childCounts.get(page.id) ?? 0,
          tagCount: tagCounts.get(page.id) ?? 0,
          pageLinkCount: pageLinkCounts.get(page.id) ?? 0,
          recordLinkCount: pageRecordCounts.get(page.id) ?? 0,
        })),
    );

    const orphanRecords = findOrphanRecords(
      recordRows.map((record) => ({
        ...record,
        relationCount: relationCounts.get(record.id) ?? 0,
        pageLinkCount: recordLinkCounts.get(record.id) ?? 0,
      })),
    );

    return NextResponse.json({
      pages: orphanPages,
      records: orphanRecords,
      total: orphanPages.length + orphanRecords.length,
    });
  } catch (error) {
    console.error("Failed to find unconnected items:", error);
    return NextResponse.json({ error: "Failed to find unconnected items" }, { status: 500 });
  }
}
