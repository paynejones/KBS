import { NextResponse } from "next/server";
import { asc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { databaseRecords, pageLinks, pages, pageTags, tags } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

/** Page ids that belong to a database record, from one indexed column. */
async function recordPageIds(): Promise<string[]> {
  const rows = await db
    .select({ pageId: databaseRecords.pageId })
    .from(databaseRecords)
    .where(isNotNull(databaseRecords.pageId));

  return rows.map((row) => row.pageId as string);
}

/**
 * The page graph, in the shape the caller needs. The default is the whole
 * graph: every page, every link, every tag.
 *
 * - `?view=record-pages` answers only "which pages belong to a record", which
 *   the recent-pages card needs; it reads no pages, links, or tags.
 * - `?view=index` returns every page with its record marker but skips the link
 *   and tag reads, which is all the command palette displays.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view");
  // The graph page opts out of record pages so they stay out of the graph and
  // its center picker. Other consumers keep the marker for their own filters.
  const excludeRecordPages = searchParams.get("excludeRecordPages") === "true";

  try {
    if (view === "record-pages") {
      return NextResponse.json({ recordPageIds: await recordPageIds() });
    }

    const indexOnly = view === "index";

    const [pageRows, linkRows, tagRows, recordPageIdsForPages] = await Promise.all([
      db.select({
        id: pages.id,
        title: pages.title,
        parentId: pages.parentId,
        isFavorite: pages.isFavorite,
      })
        .from(pages)
        .where(isNull(pages.deletedAt))
        .orderBy(asc(pages.title)),
      indexOnly
        ? []
        : db.select({ sourcePageId: pageLinks.sourcePageId, targetPageId: pageLinks.targetPageId })
            .from(pageLinks),
      // Tags travel with their pages so the graph can filter by tag and, when
      // asked, draw shared-tag edges without a second request.
      indexOnly
        ? []
        : db.select({ pageId: pageTags.pageId, id: tags.id, name: tags.name })
            .from(pageTags)
            .innerJoin(tags, eq(pageTags.tagId, tags.id))
            .orderBy(asc(tags.name)),
      recordPageIds(),
    ]);

    const recordPageIdLookup = new Set(recordPageIdsForPages);
    const visiblePages = excludeRecordPages
      ? pageRows.filter((page) => !recordPageIdLookup.has(page.id))
      : pageRows;
    const hierarchyEdges = visiblePages
      .filter((page) => page.parentId)
      .map((page) => ({ source: page.parentId!, target: page.id, type: "hierarchy" as const }));
    const pageIds = new Set(visiblePages.map((page) => page.id));
    const explicitEdges = linkRows
      .filter((link) => pageIds.has(link.sourcePageId) && pageIds.has(link.targetPageId))
      .map((link) => ({
        source: link.sourcePageId,
        target: link.targetPageId,
        type: "link" as const,
      }));

    const tagsByPage = new Map<string, { id: string; name: string }[]>();
    for (const tag of tagRows) {
      tagsByPage.set(tag.pageId, [...(tagsByPage.get(tag.pageId) ?? []), { id: tag.id, name: tag.name }]);
    }

    return NextResponse.json({
      nodes: visiblePages.map(({ id, title, parentId, isFavorite }) => ({
        id,
        title,
        parentId,
        isFavorite,
        isRecordPage: recordPageIdLookup.has(id),
        tags: tagsByPage.get(id) ?? [],
      })),
      edges: [...hierarchyEdges, ...explicitEdges],
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to load page graph", error, { status: 500, logMessage: "Failed to load page graph:" });
  }
}
