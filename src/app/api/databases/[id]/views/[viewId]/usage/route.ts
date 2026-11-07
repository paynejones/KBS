import { asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseViews, pages, pageTemplates } from "@/db/schema";

type Context = { params: Promise<{ id: string; viewId: string }> };

function embedsView(
  node: unknown,
  databaseId: string,
  viewId: string,
  knownViewIds: Set<string>,
  firstViewId: string | undefined,
): boolean {
  if (Array.isArray(node)) {
    return node.some((child) => embedsView(child, databaseId, viewId, knownViewIds, firstViewId));
  }
  if (!node || typeof node !== "object") return false;

  const record = node as Record<string, unknown>;
  if (record.type === "databaseEmbed" && record.attrs && typeof record.attrs === "object") {
    const attrs = record.attrs as Record<string, unknown>;
    if (attrs.databaseId === databaseId) {
      if (attrs.viewId === viewId) return true;
      // DatabaseEmbed renders the first view when an embed has no view or its
      // saved view no longer exists.
      if (firstViewId === viewId && (typeof attrs.viewId !== "string" || !knownViewIds.has(attrs.viewId))) {
        return true;
      }
    }
  }

  return Array.isArray(record.content)
    && record.content.some((child) => embedsView(child, databaseId, viewId, knownViewIds, firstViewId));
}

export async function GET(_request: Request, context: Context) {
  const { id, viewId } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(viewId).success) {
    return NextResponse.json({ error: "Invalid view ID" }, { status: 400 });
  }

  try {
    const viewRows = await db.select({ id: databaseViews.id })
      .from(databaseViews)
      .where(eq(databaseViews.databaseId, id))
      .orderBy(asc(databaseViews.sortOrder));
    if (!viewRows.some((candidate) => candidate.id === viewId)) {
      return NextResponse.json({ error: "View not found" }, { status: 404 });
    }
    const knownViewIds = new Set(viewRows.map((candidate) => candidate.id));
    const firstViewId = viewRows[0]?.id;

    const [pageRows, templateRows] = await Promise.all([
      db.select({
        id: pages.id,
        title: pages.title,
        contentJson: pages.contentJson,
      })
        .from(pages)
        .where(isNull(pages.deletedAt))
        .orderBy(asc(pages.title)),
      db.select({
        id: pageTemplates.id,
        name: pageTemplates.name,
        contentJson: pageTemplates.contentJson,
      })
        .from(pageTemplates)
        .orderBy(asc(pageTemplates.name)),
    ]);

    const pageUsage = pageRows
      .filter((page) => embedsView(page.contentJson, id, viewId, knownViewIds, firstViewId))
      .map((page) => ({ id: page.id, title: page.title }));
    const templateUsage = templateRows
      .filter((template) => embedsView(template.contentJson, id, viewId, knownViewIds, firstViewId))
      .map((template) => ({ id: template.id, name: template.name }));

    return NextResponse.json({ pages: pageUsage, templates: templateUsage });
  } catch (error) {
    console.error("Failed to load database view usage:", error);
    return NextResponse.json({ error: "Failed to load view usage" }, { status: 500 });
  }
}
