
import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pages } from "@/db/schema";

const createPageSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export async function GET() {
  const result = await db
    .select({
      id: pages.id,
      title: pages.title,
      createdAt: pages.createdAt,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    .orderBy(desc(pages.updatedAt));

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = createPageSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid page data" },
      { status: 400 },
    );
  }

  const [page] = await db
    .insert(pages)
    .values({ title: parsed.data.title ?? "Untitled" })
    .returning();

  return NextResponse.json(page, { status: 201 });
}
