import { eq, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databases, databaseViews } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(["table", "board", "gallery", "calendar", "list", "timeline", "chart"]),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid database ID" }, { status: 400 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid database view" }, { status: 400 });

  try {
    const [database] = await db.select({ id: databases.id }).from(databases).where(eq(databases.id, id)).limit(1);
    if (!database) return NextResponse.json({ error: "Database not found" }, { status: 404 });
    const [maxOrder] = await db.select({ value: max(databaseViews.sortOrder) }).from(databaseViews).where(eq(databaseViews.databaseId, id));
    const [view] = await db.insert(databaseViews).values({
      databaseId: id,
      name: parsed.data.name,
      type: parsed.data.type,
      config: parsed.data.config ?? {},
      sortOrder: (maxOrder?.value ?? -1) + 1,
    }).returning();
    return NextResponse.json(view, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to create database view", error, { status: 500, logMessage: "Failed to create database view:" });
  }
}
