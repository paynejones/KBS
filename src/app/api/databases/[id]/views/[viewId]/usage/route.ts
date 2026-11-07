import { and, asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseViews, pages } from "@/db/schema";

type Context = { params: Promise<{ id: string; viewId: string }> };

function embedsView(node: unknown, databaseId: string, viewId: string): boolean {
  if (Array.isArray(node)) {
    return node.some((child) => embedsView(child, databaseId, viewId));
  }
  if (!node || typeof node !== "object") return false;

  const record = node as Record<string, unknown>;
  if (record.type === "databaseEmbed" && record.attrs && typeof record.attrs === "object") {
    const attrs = record.attrs as Record<string, unknown>;
    if (attrs.databaseId === databaseId && attrs.viewId === viewId) return true;
  }

  return Array.isArray(record.content)
    && record.content.some((child) => embedsView(child, databaseId, viewId));
}

export async function GET(_request: Request, context: Context) {
  const { id, viewId } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(viewId).success) {
    return NextResponse.json({ error: "Invalid view ID" }, { status: 400 });
  }

  try {
    const [view] = await db.select({ id: databaseViews.id })
      .from(databaseViews)
      .where(and(eq(databaseViews.id, viewId), eq(databaseViews.databaseId, id)))
      .limit(1);
    if (!view) return NextResponse.json({ error: "View not found" }, { status: 404 });

    const pageRows = await db.select({
      id: pages.id,
      title: pages.title,
      contentJson: pages.contentJson,
    })
      .from(pages)
      .where(isNull(pages.deletedAt))
      .orderBy(asc(pages.title));

    const usage = pageRows
      .filter((page) => embedsView(page.contentJson, id, viewId))
      .map((page) => ({ id: page.id, title: page.title }));

    return NextResponse.json({ pages: usage });
  } catch (error) {
    console.error("Failed to load database view usage:", error);
    return NextResponse.json({ error: "Failed to load view usage" }, { status: 500 });
  }
}
