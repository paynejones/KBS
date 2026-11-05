import { NextResponse } from "next/server";
import { asc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { pageLinks, pages } from "@/db/schema";

export async function GET() {
  try {
    const [pageRows, linkRows] = await Promise.all([
      db.select({ id: pages.id, title: pages.title, parentId: pages.parentId, isFavorite: pages.isFavorite })
        .from(pages)
        .where(isNull(pages.deletedAt))
        .orderBy(asc(pages.title)),
      db.select({ sourcePageId: pageLinks.sourcePageId, targetPageId: pageLinks.targetPageId })
        .from(pageLinks),
    ]);

    const hierarchyEdges = pageRows
      .filter((page) => page.parentId)
      .map((page) => ({ source: page.parentId!, target: page.id, type: "hierarchy" as const }));
    const pageIds = new Set(pageRows.map((page) => page.id));
    const explicitEdges = linkRows
      .filter((link) => pageIds.has(link.sourcePageId) && pageIds.has(link.targetPageId))
      .map((link) => ({
        source: link.sourcePageId,
        target: link.targetPageId,
        type: "link" as const,
      }));

    return NextResponse.json({
      nodes: pageRows.map(({ id, title, isFavorite }) => ({ id, title, isFavorite })),
      edges: [...hierarchyEdges, ...explicitEdges],
    });
  } catch (error) {
    console.error("Failed to load page graph:", error);
    return NextResponse.json({ error: "Failed to load page graph" }, { status: 500 });
  }
}
