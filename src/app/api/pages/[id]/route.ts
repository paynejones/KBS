
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
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
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: "Provide at least one field to update" },
);

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;

  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  const [page] = await db
    .select()
    .from(pages)
    .where(eq(pages.id, id))
    .limit(1);

  if (!page) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  return NextResponse.json(page);
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;

  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = updatePageSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid page update" }, { status: 400 });
  }

  const [page] = await db
    .update(pages)
    .set({
      ...parsed.data,
      updatedAt: new Date(),
    })
    .where(eq(pages.id, id))
    .returning();

  if (!page) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  return NextResponse.json(page);
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;

  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  const [deleted] = await db
    .delete(pages)
    .where(eq(pages.id, id))
    .returning({ id: pages.id });

  if (!deleted) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
