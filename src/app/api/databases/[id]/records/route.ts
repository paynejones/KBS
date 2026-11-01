import { and, eq, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databases, databaseRecords, databaseTemplates } from "@/db/schema";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  templateId: z.string().uuid().optional(),
});

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid database ID" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid record" }, { status: 400 });
  try {
    const [database] = await db.select({ id: databases.id }).from(databases).where(eq(databases.id, id)).limit(1);
    if (!database) return NextResponse.json({ error: "Database not found" }, { status: 404 });
    let template: typeof databaseTemplates.$inferSelect | undefined;
    if (parsed.data.templateId) {
      const [foundTemplate] = await db.select().from(databaseTemplates).where(and(
        eq(databaseTemplates.id, parsed.data.templateId),
        eq(databaseTemplates.databaseId, id),
      )).limit(1);
      if (!foundTemplate) return NextResponse.json({ error: "Template not found" }, { status: 404 });
      template = foundTemplate;
    }
    const [maxOrder] = await db.select({ value: max(databaseRecords.sortOrder) }).from(databaseRecords).where(eq(databaseRecords.databaseId, id));
    const [record] = await db.insert(databaseRecords).values({
      databaseId: id,
      title: parsed.data.title ?? template?.title ?? "Untitled",
      values: template?.values ?? {},
      sortOrder: (maxOrder?.value ?? -1) + 1,
    }).returning();
    return NextResponse.json({ ...record, relations: {} }, { status: 201 });
  } catch (error) {
    console.error("Failed to create database record:", error);
    return NextResponse.json({ error: "Failed to create database record" }, { status: 500 });
  }
}
