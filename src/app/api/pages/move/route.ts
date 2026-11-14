
import { NextResponse } from "next/server";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { z } from "zod";
import { logApiError } from "@/lib/api-log";

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
      .select({ id: pages.id, parentId: pages.parentId })
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
        .select({ id: pages.id })
        .from(pages)
        .where(eq(pages.id, newParentId))
        .limit(1);

      if (!parent) {
        return NextResponse.json(
          { error: "Destination parent not found." },
          { status: 404 }
        );
      }

      // Prevent moving a page into one of its own descendants. Walking up from
      // the destination visits only that page's ancestors — the move is illegal
      // exactly when the page being moved is one of them — so this used to read
      // every page row, bodies included, to answer a question about one chain.
      const { rows: ancestorRows } = await db.execute<{ isDescendant: boolean }>(sql`
        with recursive ancestors as (
          select id, parent_id from pages where id = ${newParentId}
          union
          select pages.id, pages.parent_id
          from pages
          join ancestors on pages.id = ancestors.parent_id
        )
        select exists (select 1 from ancestors where id = ${pageId}) as "isDescendant"
      `);

      if (ancestorRows[0]?.isDescendant) {
        return NextResponse.json(
          { error: "A page cannot be moved into its own descendant." },
          { status: 400 }
        );
      }
    }

    if (targetPageId) {
      const [target] = await db
        .select({ id: pages.id, parentId: pages.parentId })
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

    // The page's old parent loses a child, so its remaining children need new
    // positions too; neither read depends on the other, so they go together.
    // Siblings with equal positions are ordered by title, the way the reorder
    // route reads them, so duplicates always resolve the same way.
    const [siblings, previousSiblings] = await Promise.all([
      db
        .select({ id: pages.id })
        .from(pages)
        .where(
          newParentId
            ? eq(pages.parentId, newParentId)
            : isNull(pages.parentId)
        )
        .orderBy(asc(pages.sortOrder), asc(pages.title)),
      page.parentId === newParentId
        ? Promise.resolve([] as { id: string }[])
        : db
            .select({ id: pages.id })
            .from(pages)
            .where(
              page.parentId
                ? eq(pages.parentId, page.parentId)
                : isNull(pages.parentId)
            )
            .orderBy(asc(pages.sortOrder), asc(pages.title)),
    ]);

    const remainingSiblings = siblings
      .map((sibling) => sibling.id)
      .filter((siblingId) => siblingId !== pageId);

    let insertIndex = remainingSiblings.length;

    if (targetPageId && position !== "inside") {
      const targetIndex = remainingSiblings.indexOf(targetPageId);

      if (targetIndex === -1) {
        return NextResponse.json(
          { error: "Invalid target position." },
          { status: 400 }
        );
      }

      insertIndex =
        position === "before" ? targetIndex : targetIndex + 1;
    }

    remainingSiblings.splice(insertIndex, 0, pageId);

    const orphanedSiblings = previousSiblings
      .map((sibling) => sibling.id)
      .filter((siblingId) => siblingId !== pageId);

    // One statement for both parents: each row already knows its new position,
    // so the positions travel with the ids instead of one UPDATE per sibling.
    // A single statement is atomic on its own, so no transaction.
    const positions = [
      ...remainingSiblings.map((siblingId, position) => ({
        pageId: siblingId,
        parentId: newParentId,
        position,
      })),
      ...orphanedSiblings.map((siblingId, position) => ({
        pageId: siblingId,
        parentId: page.parentId,
        position,
      })),
    ];
    const reordered = positions.map(
      (row) => sql`(${row.pageId}::uuid, ${row.parentId}::uuid, ${row.position}::int)`
    );

    await db.execute(sql`
      update pages as moved
      set parent_id = positions.parent_id,
          sort_order = positions.position
      from (values ${sql.join(reordered, sql`, `)}) as positions(id, parent_id, position)
      where moved.id = positions.id
    `);

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(request, "Move page error", error);

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
