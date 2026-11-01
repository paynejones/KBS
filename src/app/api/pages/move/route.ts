
import { NextResponse } from "next/server";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { z } from "zod";

const movePageSchema = z.object({
  pageId: z.string().uuid(),
  newParentId: z.string().uuid().nullable(),
  targetPageId: z.string().uuid().nullable().optional(),
  position: z.enum(["before", "after", "inside"]),
});

export async function POST(request: Request) {
  try {
    const body = movePageSchema.parse(await request.json());

    const { pageId, newParentId, targetPageId, position } = body;

    if (pageId === newParentId || pageId === targetPageId) {
      return NextResponse.json(
        { error: "A page cannot be moved into itself." },
        { status: 400 }
      );
    }

    const [page] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, pageId))
      .limit(1);

    if (!page) {
      return NextResponse.json(
        { error: "Page not found." },
        { status: 404 }
      );
    }

    if (newParentId) {
      const [parent] = await db
        .select()
        .from(pages)
        .where(eq(pages.id, newParentId))
        .limit(1);

      if (!parent) {
        return NextResponse.json(
          { error: "Destination parent not found." },
          { status: 404 }
        );
      }

      // Prevent moving a page into one of its descendants.
      const allPages = await db.select().from(pages);
      const descendants = new Set<string>();
      let changed = true;

      while (changed) {
        changed = false;

        for (const candidate of allPages) {
          if (
            candidate.parentId &&
            (candidate.parentId === pageId ||
              descendants.has(candidate.parentId)) &&
            !descendants.has(candidate.id)
          ) {
            descendants.add(candidate.id);
            changed = true;
          }
        }
      }

      if (descendants.has(newParentId)) {
        return NextResponse.json(
          { error: "A page cannot be moved into its own descendant." },
          { status: 400 }
        );
      }
    }

    if (targetPageId) {
      const [target] = await db
        .select()
        .from(pages)
        .where(eq(pages.id, targetPageId))
        .limit(1);

      if (!target) {
        return NextResponse.json(
          { error: "Target page not found." },
          { status: 404 }
        );
      }

      if (position === "inside" && targetPageId !== newParentId) {
        return NextResponse.json(
          { error: "Invalid destination parent." },
          { status: 400 }
        );
      }

      if (position !== "inside" && target.parentId !== newParentId) {
        return NextResponse.json(
          { error: "Pages must be siblings to be reordered." },
          { status: 400 }
        );
      }
    }

    const siblings = await db
      .select()
      .from(pages)
      .where(
        newParentId
          ? eq(pages.parentId, newParentId)
          : isNull(pages.parentId)
      )
      .orderBy(pages.sortOrder);

    const remainingSiblings = siblings.filter(
      (sibling) => sibling.id !== pageId
    );

    let insertIndex = remainingSiblings.length;

    if (targetPageId && position !== "inside") {
      const targetIndex = remainingSiblings.findIndex(
        (sibling) => sibling.id === targetPageId
      );

      if (targetIndex === -1) {
        return NextResponse.json(
          { error: "Invalid target position." },
          { status: 400 }
        );
      }

      insertIndex =
        position === "before" ? targetIndex : targetIndex + 1;
    }

    remainingSiblings.splice(insertIndex, 0, {
      ...page,
      parentId: newParentId,
    });

    await db.transaction(async (tx) => {
      for (let index = 0; index < remainingSiblings.length; index++) {
        const sibling = remainingSiblings[index];

        await tx
          .update(pages)
          .set({
            parentId: newParentId,
            sortOrder: index,
          })
          .where(eq(pages.id, sibling.id));
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Move page error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data.", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to move page." },
      { status: 500 }
    );
  }
}
