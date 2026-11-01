import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databases, databaseProperties, databaseTemplates } from "@/db/schema";
import { validateDatabaseRecordValues } from "@/lib/database-values";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({
  name: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  values: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid database ID" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid template" }, { status: 400 });
  try {
    const [database] = await db.select({ id: databases.id }).from(databases).where(eq(databases.id, id)).limit(1);
    if (!database) return NextResponse.json({ error: "Database not found" }, { status: 404 });
    const templatePropertyIds = Object.keys(parsed.data.values);
    const templateProperties = templatePropertyIds.length > 0
      ? await db.select().from(databaseProperties).where(eq(databaseProperties.databaseId, id))
      : [];
    const valueError = validateDatabaseRecordValues(parsed.data.values, templateProperties);
    if (valueError) return NextResponse.json({ error: valueError }, { status: 400 });
    const [template] = await db.insert(databaseTemplates).values({ databaseId: id, ...parsed.data }).returning();
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    console.error("Failed to create database template:", error);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}
