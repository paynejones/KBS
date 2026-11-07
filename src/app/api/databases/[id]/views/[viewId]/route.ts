import { and, count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseViews } from "@/db/schema";

type Context = { params: Promise<{ id: string; viewId: string }> };
const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
}).refine((data) => Object.keys(data).length > 0);

export async function PATCH(request: Request, context: Context) {
  const { id, viewId } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(viewId).success) {
    return NextResponse.json({ error: "Invalid view ID" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid view update" }, { status: 400 });

  try {
    const [view] = await db.update(databaseViews)
      .set(parsed.data)
      .where(and(eq(databaseViews.id, viewId), eq(databaseViews.databaseId, id)))
      .returning();
    if (!view) return NextResponse.json({ error: "View not found" }, { status: 404 });
    return NextResponse.json(view);
  } catch (error) {
    console.error("Failed to update database view:", error);
    return NextResponse.json({ error: "Failed to update database view" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: Context) {
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

    const [viewCount] = await db.select({ value: count() })
      .from(databaseViews)
      .where(eq(databaseViews.databaseId, id));
    if ((viewCount?.value ?? 0) <= 1) {
      return NextResponse.json({ error: "A database must keep at least one view" }, { status: 409 });
    }

    const [deleted] = await db.delete(databaseViews)
      .where(and(eq(databaseViews.id, viewId), eq(databaseViews.databaseId, id)))
      .returning({ id: databaseViews.id });
    if (!deleted) return NextResponse.json({ error: "View not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete database view:", error);
    return NextResponse.json({ error: "Failed to delete database view" }, { status: 500 });
  }
}
