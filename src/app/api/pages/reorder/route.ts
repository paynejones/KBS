
import { NextResponse } from "next/server";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

const reorderSchema = z.object({
  pageId: z.string().uuid(),
  direction: z.enum(["up", "down"]),
});

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = reorderSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid reorder request." },
      { status: 400 }
    );
  }

  const { pageId, direction } = parsed.data;

  try {
  // Find the page being moved.
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

  // Fetch only pages with the same parent.
  const siblings = await db
    .select({
      id: pages.id,
      sortOrder: pages.sortOrder,
    })
    .from(pages)
    .where(
      page.parentId
        ? eq(pages.parentId, page.parentId)
        : isNull(pages.parentId)
    )
    .orderBy(asc(pages.sortOrder), asc(pages.title));

  const currentIndex = siblings.findIndex(
    (sibling) => sibling.id === pageId
  );

  const targetIndex =
    direction === "up" ? currentIndex - 1 : currentIndex + 1;

  // Nothing to do if the page is already at the boundary.
  if (targetIndex < 0 || targetIndex >= siblings.length) {
    return NextResponse.json({ success: true });
  }

  const currentPage = siblings[currentIndex];
  const targetPage = siblings[targetIndex];

  // Swap both positions in one statement: the two rows already know their new
  // sort orders, so the orders travel with the ids instead of two UPDATEs.
  const swapped = [
    { id: currentPage.id, sortOrder: targetPage.sortOrder },
    { id: targetPage.id, sortOrder: currentPage.sortOrder },
  ].map((row) => sql`(${row.id}::uuid, ${row.sortOrder}::int)`);

  await db.execute(sql`
    update pages as reordered
    set sort_order = positions.position
    from (values ${sql.join(swapped, sql`, `)}) as positions(id, position)
    where reordered.id = positions.id
  `);

  return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to reorder pages.", error, { status: 500, logMessage: "Failed to reorder pages:" });
  }
}
