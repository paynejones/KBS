import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pageRevisions, pages } from "@/db/schema";

type Context = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();
const restoreSchema = z.object({ revisionId: z.string().uuid() });

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  try {
    const [page] = await db.select({ id: pages.id }).from(pages).where(eq(pages.id, id)).limit(1);
    if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    const revisions = await db
      .select({ id: pageRevisions.id, title: pageRevisions.title, content: pageRevisions.content, createdAt: pageRevisions.createdAt })
      .from(pageRevisions)
      .where(eq(pageRevisions.pageId, id))
      .orderBy(desc(pageRevisions.createdAt))
      .limit(100);

    return NextResponse.json(revisions);
  } catch (error) {
    console.error("Failed to fetch page revisions:", error);
    return NextResponse.json({ error: "Failed to fetch page revisions" }, { status: 500 });
  }
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = restoreSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid revision" }, { status: 400 });

  try {
    const restoredPage = await db.transaction(async (tx) => {
      const [page] = await tx.select().from(pages).where(eq(pages.id, id)).limit(1);
      if (!page) return { error: "Page not found", status: 404 as const };

      const [revision] = await tx
        .select()
        .from(pageRevisions)
        .where(eq(pageRevisions.id, parsed.data.revisionId))
        .limit(1);
      if (!revision || revision.pageId !== id) return { error: "Revision not found", status: 404 as const };

      await tx.insert(pageRevisions).values({
        pageId: page.id,
        title: page.title,
        content: page.content,
        contentJson: page.contentJson,
      });

      const oldRevisions = await tx
        .select({ id: pageRevisions.id })
        .from(pageRevisions)
        .where(eq(pageRevisions.pageId, id))
        .orderBy(desc(pageRevisions.createdAt))
        .offset(100);
      if (oldRevisions.length) {
        await tx.delete(pageRevisions).where(inArray(pageRevisions.id, oldRevisions.map((item) => item.id)));
      }

      const [updated] = await tx
        .update(pages)
        .set({ title: revision.title, content: revision.content, contentJson: revision.contentJson, updatedAt: new Date() })
        .where(eq(pages.id, id))
        .returning();
      return { page: updated };
    });

    if ("error" in restoredPage) {
      return NextResponse.json({ error: restoredPage.error }, { status: restoredPage.status });
    }
    return NextResponse.json(restoredPage.page);
  } catch (error) {
    console.error("Failed to restore page revision:", error);
    return NextResponse.json({ error: "Failed to restore page revision" }, { status: 500 });
  }
}
