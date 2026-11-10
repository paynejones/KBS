import { NextResponse } from "next/server";
import { asc, eq, exists, isNull } from "drizzle-orm";
import { db } from "@/db";
import { databaseRecords, pageLinks, pages, pageTags, tags } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

export async function GET(request: Request) {
  try {
    const [pageRows, linkRows, tagRows] = await Promise.all([
      db.select({
        id: pages.id,
        title: pages.title,
        parentId: pages.parentId,
        isFavorite: pages.isFavorite,
        // Record pages stay out of the command palette's page results while
        // remaining ordinary, directly openable pages.
        isRecordPage: exists(
          db.select({ id: databaseRecords.id })
            .from(databaseRecords)
            .where(eq(databaseRecords.pageId, pages.id)),
        ),
      })
        .from(pages)
        .where(isNull(pages.deletedAt))
        .orderBy(asc(pages.title)),
      db.select({ sourcePageId: pageLinks.sourcePageId, targetPageId: pageLinks.targetPageId })
        .from(pageLinks),
      // Tags travel with their pages so the graph can filter by tag and, when
      // asked, draw shared-tag edges without a second request.
      db.select({ pageId: pageTags.pageId, id: tags.id, name: tags.name })
        .from(pageTags)
        .innerJoin(tags, eq(pageTags.tagId, tags.id))
        .orderBy(asc(tags.name)),
    ]);

    // The graph page opts out of record pages so they stay out of the graph and
    // its center picker. Other consumers keep the marker for their own filters.
    const visiblePages = request && new URL(request.url).searchParams.get("excludeRecordPages") === "true"
      ? pageRows.filter((page) => !page.isRecordPage)
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
      nodes: visiblePages.map(({ id, title, parentId, isFavorite, isRecordPage }) => ({
        id,
        title,
        parentId,
        isFavorite,
        isRecordPage,
        tags: tagsByPage.get(id) ?? [],
      })),
      edges: [...hierarchyEdges, ...explicitEdges],
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to load page graph", error, { status: 500, logMessage: "Failed to load page graph:" });
  }
}
