import { and, eq, isNull, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databases, databaseRecords, databaseTemplates, pages } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

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
    const title = parsed.data.title ?? template?.title ?? "Untitled";
    // Every record owns a full page so its properties and content live together.
    // Creating both in one transaction avoids records without a page.
    const record = await db.transaction(async (tx) => {
      const [maxOrder] = await tx.select({ value: max(databaseRecords.sortOrder) })
        .from(databaseRecords).where(eq(databaseRecords.databaseId, id));
      const [pageOrder] = await tx.select({ value: max(pages.sortOrder) })
        .from(pages).where(isNull(pages.parentId));
      const [page] = await tx.insert(pages).values({
        title,
        sortOrder: (pageOrder?.value ?? -1) + 1,
      }).returning({ id: pages.id });
      const [created] = await tx.insert(databaseRecords).values({
        databaseId: id,
        pageId: page.id,
        title,
        values: template?.values ?? {},
        sortOrder: (maxOrder?.value ?? -1) + 1,
      }).returning();
      return created;
    });
    return NextResponse.json({ ...record, relations: {} }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to create database record", error, { status: 500, logMessage: "Failed to create database record:" });
  }
}
