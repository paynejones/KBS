import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { pageLinks, pages } from "@/db/schema";
import { backlinkContexts } from "@/lib/backlinks";

type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();
const linkSchema = z.object({
  targetPageId: z.string().uuid(),
  origin: z.enum(["inline", "manual"]).optional(),
});

export async function GET(_request: Request, context: Context) {
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

    const [links, backlinkRows] = await Promise.all([
      db
        .select({ id: pages.id, title: pages.title })
        .from(pageLinks)
        .innerJoin(pages, eq(pageLinks.targetPageId, pages.id))
        .where(and(eq(pageLinks.sourcePageId, id), isNull(pages.deletedAt)))
        .orderBy(pages.title),
      db
        .select({ id: pages.id, title: pages.title, contentJson: pages.contentJson })
        .from(pageLinks)
        .innerJoin(pages, eq(pageLinks.sourcePageId, pages.id))
        .where(and(eq(pageLinks.targetPageId, id), isNull(pages.deletedAt)))
        .orderBy(pages.title),
    ]);

    // Quote the sentence around each inline link so a backlink can be judged
    // without opening the source page. Links added from the connections panel
    // have no content behind them and therefore no snippets.
    const backlinks = backlinkRows.map(({ id: sourceId, title, contentJson }) => ({
      id: sourceId,
      title,
      contexts: backlinkContexts(contentJson, id),
    }));

    return NextResponse.json({ links, backlinks });
  } catch (error) {
    console.error("Failed to load page links:", error);
    return NextResponse.json({ error: "Failed to load page links" }, { status: 500 });
  }
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }
  const parsed = linkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid target page" }, { status: 400 });
  }
  if (parsed.data.targetPageId === id) {
    return NextResponse.json({ error: "A page cannot link to itself" }, { status: 400 });
  }

  try {
    const [target] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, parsed.data.targetPageId), isNull(pages.deletedAt)))
      .limit(1);
    if (!target) {
      return NextResponse.json({ error: "Target page not found" }, { status: 404 });
    }

    const origin = parsed.data.origin ?? "manual";
    const link = db
      .insert(pageLinks)
      .values({ sourcePageId: id, targetPageId: target.id, origin });

    if (origin === "manual") {
      // A connection chosen in the panel is deliberate, so it keeps outliving
      // inline links by promoting an existing inline row.
      await link.onConflictDoUpdate({
        target: [pageLinks.sourcePageId, pageLinks.targetPageId],
        set: { origin: "manual" },
      });
    } else {
      await link.onConflictDoNothing();
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("Failed to link pages:", error);
    return NextResponse.json({ error: "Failed to link pages" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }
  const parsed = linkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid target page" }, { status: 400 });
  }

  try {
    await db
      .delete(pageLinks)
      .where(
        and(
          eq(pageLinks.sourcePageId, id),
          eq(pageLinks.targetPageId, parsed.data.targetPageId),
          parsed.data.origin ? eq(pageLinks.origin, parsed.data.origin) : undefined,
        ),
      );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to unlink pages:", error);
    return NextResponse.json({ error: "Failed to unlink pages" }, { status: 500 });
  }
}
