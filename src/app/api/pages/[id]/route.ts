
import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { databaseRecords, pageRevisions, pages } from "@/db/schema";
import { isAllowedMediaUrl } from "@/lib/media";
import { collectSubtreeIds } from "@/lib/trash";

type Context = {
  params: Promise<{ id: string }>;
};

const idSchema = z.string().uuid();

const updatePageSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(2_000_000).optional(),
  contentJson: z.record(z.string(), z.unknown()).optional(),
  parentId: z.string().uuid().nullable().optional(),
  isFavorite: z.boolean().optional(),
  icon: z.string().max(32).nullable().optional(),
  coverImageUrl: z.string().trim().max(2048).nullable().optional(),
  selectedText: z.string().max(2_000).nullable().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: "Provide at least one field to update" },
).refine(
  (data) => !data.coverImageUrl || isAllowedMediaUrl(data.coverImageUrl),
  { message: "Cover image must be an uploaded file or an http(s) URL" },
);

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;

  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  try {
    const [page] = await db
      .select()
      .from(pages)
      .where(and(eq(pages.id, id), isNull(pages.deletedAt)))
      .limit(1);

    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    return NextResponse.json(page);
  } catch (error) {
    console.error("Failed to fetch page:", error);
    return NextResponse.json({ error: "Failed to fetch page" }, { status: 500 });
  }
}


export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;

  if (!idSchema.safeParse(id).success) {
    return NextResponse.json(
      { error: "Invalid page ID" },
      { status: 400 }
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = updatePageSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid page update" },
      { status: 400 }
    );
  }

  try {
  // Confirm the page exists.
    const [existingPage] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, id), isNull(pages.deletedAt)))
    .limit(1);

  if (!existingPage) {
    return NextResponse.json(
      { error: "Page not found" },
      { status: 404 }
    );
  }

  // An emptied quote is stored as no quote at all, so clearing the field on a
  // page means the same thing as never capturing a passage.
  const updates = {
    ...parsed.data,
    ...(parsed.data.selectedText !== undefined
      ? { selectedText: parsed.data.selectedText?.trim() || null }
      : {}),
  };

  // Validate a requested parent change.
  if (parsed.data.parentId !== undefined && parsed.data.parentId !== null) {
    const newParentId = parsed.data.parentId;

    // A page cannot be its own parent.
    if (newParentId === id) {
      return NextResponse.json(
        { error: "A page cannot be its own parent." },
        { status: 400 }
      );
    }

    const allPages = await db
      .select({
        id: pages.id,
        parentId: pages.parentId,
      })
      .from(pages);

    const parentExists = allPages.some(
      (page) => page.id === newParentId
    );

    if (!parentExists) {
      return NextResponse.json(
        { error: "Parent page not found." },
        { status: 404 }
      );
    }

    // Find all descendants of the page being moved.
    const descendants = new Set<string>();
    let currentLevel = [id];

    while (currentLevel.length > 0) {
      const nextLevel = allPages
        .filter(
          (page) =>
            page.parentId !== null &&
            currentLevel.includes(page.parentId) &&
            !descendants.has(page.id)
        )
        .map((page) => page.id);

      for (const descendantId of nextLevel) {
        descendants.add(descendantId);
      }

      currentLevel = nextLevel;
    }

    // Prevent moving a page underneath one of its descendants.
    if (descendants.has(newParentId)) {
      return NextResponse.json(
        { error: "Cannot move a page inside its own descendants." },
        { status: 400 }
      );
    }
  }

     // Determine whether the page is actually changing parents.
  const isMoving =
    parsed.data.parentId !== undefined &&
    parsed.data.parentId !== existingPage.parentId;

  let nextSortOrder: number | undefined;

  if (isMoving) {
    const newParentId = parsed.data.parentId ?? null;

    // Find the highest sort position among the destination's siblings.
    const [result] = await db
      .select({
        maxSortOrder: max(pages.sortOrder),
      })
      .from(pages)
      .where(
        newParentId
          ? eq(pages.parentId, newParentId)
          : isNull(pages.parentId)
      );

    nextSortOrder = (result?.maxSortOrder ?? -1) + 1;
  }

  const page = await db.transaction(async (tx) => {
    const contentChanged =
      (parsed.data.title !== undefined && parsed.data.title !== existingPage.title) ||
      (parsed.data.content !== undefined && parsed.data.content !== existingPage.content) ||
      (parsed.data.contentJson !== undefined && JSON.stringify(parsed.data.contentJson) !== JSON.stringify(existingPage.contentJson));

    if (contentChanged) {
      const [latestRevision] = await tx
        .select({ createdAt: pageRevisions.createdAt })
        .from(pageRevisions)
        .where(eq(pageRevisions.pageId, id))
        .orderBy(desc(pageRevisions.createdAt))
        .limit(1);

      if (!latestRevision || Date.now() - latestRevision.createdAt.getTime() >= 60_000) {
        await tx.insert(pageRevisions).values({
          pageId: id,
          title: existingPage.title,
          content: existingPage.content,
          contentJson: existingPage.contentJson,
        });

        const oldRevisions = await tx
          .select({ id: pageRevisions.id })
          .from(pageRevisions)
          .where(eq(pageRevisions.pageId, id))
          .orderBy(desc(pageRevisions.createdAt))
          .offset(100);

        if (oldRevisions.length) {
          await tx.delete(pageRevisions).where(inArray(pageRevisions.id, oldRevisions.map((revision) => revision.id)));
        }
      }
    }

    const [updatedPage] = await tx
      .update(pages)
      .set({
        ...updates,
        ...(nextSortOrder !== undefined ? { sortOrder: nextSortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(pages.id, id))
      .returning();

    // A record's page keeps the record title in step so the full record view
    // and the standalone page never disagree.
    if (parsed.data.title !== undefined && parsed.data.title !== existingPage.title) {
      await tx
        .update(databaseRecords)
        .set({ title: parsed.data.title, updatedAt: new Date() })
        .where(eq(databaseRecords.pageId, id));
    }

    return updatedPage;
  });

  return NextResponse.json(page);
  } catch (error) {
    console.error("Failed to update page:", error);
    return NextResponse.json({ error: "Failed to update page" }, { status: 500 });
  }
}



export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;

  if (!idSchema.safeParse(id).success) {
    return NextResponse.json(
      { error: "Invalid page ID" },
      { status: 400 }
    );
  }

  try {
    const trashedCount = await db.transaction(async (tx) => {
      const hierarchy = await tx
        .select({ id: pages.id, parentId: pages.parentId })
        .from(pages);

      const [page] = await tx
        .select({ id: pages.id })
        .from(pages)
        .where(eq(pages.id, id))
        .limit(1);

      if (!page) return null;

      // Trashing a page trashes its whole subtree so children are never
      // left pointing at a page that no longer renders.
      const ids = collectSubtreeIds(hierarchy, id);

      await tx
        .update(pages)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(inArray(pages.id, ids));

      return ids.length;
    });

    if (trashedCount === null) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, trashedCount });
  } catch (error) {
    console.error("Failed to delete page:", error);
    return NextResponse.json({ error: "Failed to delete page" }, { status: 500 });
  }
}
