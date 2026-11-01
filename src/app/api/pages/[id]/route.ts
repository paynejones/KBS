
import { NextResponse } from "next/server";
import { eq, max, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pages } from "@/db/schema";

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
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: "Provide at least one field to update" },
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
      .where(eq(pages.id, id))
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
    .select({
        id: pages.id,
        parentId: pages.parentId,
    })
    .from(pages)
    .where(eq(pages.id, id))
    .limit(1);

  if (!existingPage) {
    return NextResponse.json(
      { error: "Page not found" },
      { status: 404 }
    );
  }

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

  const [page] = await db
    .update(pages)
    .set({
      ...parsed.data,
      ...(nextSortOrder !== undefined
        ? { sortOrder: nextSortOrder }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(pages.id, id))
    .returning();

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
    const deleted = await db.transaction(async (tx) => {
      const [page] = await tx
        .select({ id: pages.id, parentId: pages.parentId })
        .from(pages)
        .where(eq(pages.id, id))
        .limit(1);

      if (!page) return false;

      await tx
        .update(pages)
        .set({ parentId: page.parentId, updatedAt: new Date() })
        .where(eq(pages.parentId, id));

      const [deletedPage] = await tx
        .delete(pages)
        .where(eq(pages.id, id))
        .returning({ id: pages.id });

      return Boolean(deletedPage);
    });

    if (!deleted) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete page:", error);
    return NextResponse.json({ error: "Failed to delete page" }, { status: 500 });
  }
}
