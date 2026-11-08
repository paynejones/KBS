import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseViews, databases } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({
  viewIds: z.array(z.string().uuid()).min(1).max(100),
});

/**
 * Saves a whole tab order at once. The client sends every view id, so a swap,
 * or a duplicated view inserted next to its source, is one atomic request
 * instead of a sequence of partial updates.
 */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid database ID" }, { status: 400 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid view order" }, { status: 400 });

  const viewIds = parsed.data.viewIds;
  if (new Set(viewIds).size !== viewIds.length) {
    return NextResponse.json({ error: "A view appears more than once" }, { status: 400 });
  }

  try {
    const [database] = await db
      .select({ id: databases.id })
      .from(databases)
      .where(eq(databases.id, id))
      .limit(1);
    if (!database) return NextResponse.json({ error: "Database not found" }, { status: 404 });

    const existing = await db
      .select({ id: databaseViews.id })
      .from(databaseViews)
      .where(eq(databaseViews.databaseId, id))
      .orderBy(asc(databaseViews.sortOrder));
    const known = new Set(existing.map((view) => view.id));
    if (viewIds.length !== existing.length || viewIds.some((viewId) => !known.has(viewId))) {
      return NextResponse.json(
        { error: "The order must list every view in this database" },
        { status: 400 },
      );
    }

    await db.transaction(async (tx) => {
      for (const [index, viewId] of viewIds.entries()) {
        await tx
          .update(databaseViews)
          .set({ sortOrder: index })
          .where(and(eq(databaseViews.id, viewId), eq(databaseViews.databaseId, id)));
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to reorder database views", error, {
      status: 500,
      logMessage: "Failed to reorder database views:",
    });
  }
}
