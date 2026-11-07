import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databases, databaseProperties, databaseTemplates } from "@/db/schema";
import { missingAttachmentIds } from "@/lib/attachment-store";
import { referencedAttachmentIds, validateDatabaseRecordValues } from "@/lib/database-values";
import { apiErrorResponse } from "@/lib/api-log";

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
    const missing = await missingAttachmentIds(referencedAttachmentIds(parsed.data.values, templateProperties));
    if (missing.length > 0) return NextResponse.json({ error: "A file value points to a missing attachment." }, { status: 400 });
    const [template] = await db.insert(databaseTemplates).values({ databaseId: id, ...parsed.data }).returning();
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to create template", error, { status: 500, logMessage: "Failed to create database template:" });
  }
}
