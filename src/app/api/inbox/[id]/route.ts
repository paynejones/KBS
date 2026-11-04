import { and, eq, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseProperties, databaseRecords, databases, pages } from "@/db/schema";

type Context = { params: Promise<{ id: string }> };

const databaseSchema = z.object({ databaseId: z.string().uuid() });

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid inbox item ID." }, { status: 400 });
  }
  const parsed = databaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid database." }, { status: 400 });

  try {
    const result = await db.transaction(async (tx) => {
      const [item] = await tx.select().from(pages)
        .where(and(eq(pages.id, id), eq(pages.isInbox, true))).limit(1);
      if (!item) return { error: "Inbox item not found.", status: 404 as const };

      const [database] = await tx.select({ id: databases.id })
        .from(databases).where(eq(databases.id, parsed.data.databaseId)).limit(1);
      if (!database) return { error: "Database not found.", status: 404 as const };

      const properties = await tx.select().from(databaseProperties)
        .where(eq(databaseProperties.databaseId, database.id));
      const values: Record<string, unknown> = {};
      const findProperty = (types: string[], names: string[]) => properties.find((property) =>
        types.includes(property.type) && names.includes(property.name.trim().toLowerCase()),
      );

      if (item.sourceUrl) {
        const property = findProperty(["url"], ["url", "source", "link", "website"])
          ?? properties.find((candidate) => candidate.type === "url");
        if (property) values[property.id] = item.sourceUrl;
      }
      if (item.content) {
        const property = findProperty(["text"], ["note", "notes", "content", "description"])
          ?? properties.find((candidate) => candidate.type === "text");
        if (property) values[property.id] = item.content;
      }
      if (item.capturedAt) {
        const property = findProperty(["date"], ["captured", "captured at", "date", "created"])
          ?? properties.find((candidate) => candidate.type === "date");
        if (property) values[property.id] = item.capturedAt.toISOString().slice(0, 10);
      }

      const [maxOrder] = await tx.select({ value: max(databaseRecords.sortOrder) })
        .from(databaseRecords).where(eq(databaseRecords.databaseId, database.id));
      const [record] = await tx.insert(databaseRecords).values({
        databaseId: database.id,
        pageId: item.id,
        title: item.title || "Untitled",
        values,
        sortOrder: (maxOrder?.value ?? -1) + 1,
      }).returning();
      await tx.update(pages).set({ isInbox: false, updatedAt: new Date() })
        .where(eq(pages.id, item.id));
      return { record };
    });

    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.record, { status: 201 });
  } catch (error) {
    console.error("Failed to move inbox item to database:", error);
    return NextResponse.json({ error: "Failed to move inbox item to database." }, { status: 500 });
  }
}

export async function PATCH(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid inbox item ID." }, { status: 400 });
  }
  try {
    const [item] = await db.update(pages).set({ isInbox: false, updatedAt: new Date() })
      .where(and(eq(pages.id, id), eq(pages.isInbox, true)))
      .returning({ id: pages.id, isInbox: pages.isInbox });
    if (!item) return NextResponse.json({ error: "Inbox item not found." }, { status: 404 });
    return NextResponse.json(item);
  } catch (error) {
    console.error("Failed to organize inbox item:", error);
    return NextResponse.json({ error: "Failed to organize inbox item." }, { status: 500 });
  }
}
