import { eq, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databases, databaseProperties } from "@/db/schema";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(["text", "number", "checkbox", "select", "multi_select", "date", "url", "relation", "rollup"]).default("text"),
  options: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid database ID" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid property" }, { status: 400 });

  try {
    const [database] = await db.select({ id: databases.id }).from(databases).where(eq(databases.id, id)).limit(1);
    if (!database) return NextResponse.json({ error: "Database not found" }, { status: 404 });
    if (parsed.data.type === "relation") {
      const relatedDatabaseId = parsed.data.options?.relatedDatabaseId;
      if (typeof relatedDatabaseId !== "string" || !z.string().uuid().safeParse(relatedDatabaseId).success) {
        return NextResponse.json({ error: "Choose a database for this relation" }, { status: 400 });
      }
      const [relatedDatabase] = await db.select({ id: databases.id }).from(databases).where(eq(databases.id, relatedDatabaseId)).limit(1);
      if (!relatedDatabase) return NextResponse.json({ error: "Related database not found" }, { status: 404 });
    }
    if (parsed.data.type === "rollup") {
      const options = parsed.data.options ?? {};
      const relationPropertyId = options.relationPropertyId;
      const aggregation = options.aggregation;
      if (typeof relationPropertyId !== "string" || !z.string().uuid().safeParse(relationPropertyId).success) {
        return NextResponse.json({ error: "Choose a relation property for this rollup" }, { status: 400 });
      }
      if (!["count", "sum", "average", "min", "max"].includes(String(aggregation))) {
        return NextResponse.json({ error: "Invalid rollup calculation" }, { status: 400 });
      }
      const [relationProperty] = await db.select().from(databaseProperties).where(eq(databaseProperties.id, relationPropertyId)).limit(1);
      if (!relationProperty || relationProperty.databaseId !== id || relationProperty.type !== "relation") {
        return NextResponse.json({ error: "Relation property not found" }, { status: 400 });
      }
      if (aggregation !== "count") {
        const targetPropertyId = options.targetPropertyId;
        const relatedDatabaseId = relationProperty.options.relatedDatabaseId;
        if (typeof targetPropertyId !== "string" || !z.string().uuid().safeParse(targetPropertyId).success || typeof relatedDatabaseId !== "string") {
          return NextResponse.json({ error: "Choose a numeric property to summarize" }, { status: 400 });
        }
        const [targetProperty] = await db.select().from(databaseProperties).where(eq(databaseProperties.id, targetPropertyId)).limit(1);
        if (!targetProperty || targetProperty.databaseId !== relatedDatabaseId || targetProperty.type !== "number") {
          return NextResponse.json({ error: "Rollup calculations require a number property from the related database" }, { status: 400 });
        }
      }
    }
    const [maxOrder] = await db.select({ value: max(databaseProperties.sortOrder) }).from(databaseProperties).where(eq(databaseProperties.databaseId, id));
    const [property] = await db.insert(databaseProperties).values({
      databaseId: id,
      name: parsed.data.name,
      type: parsed.data.type,
      options: parsed.data.options ?? {},
      sortOrder: (maxOrder?.value ?? -1) + 1,
    }).returning();
    return NextResponse.json(property, { status: 201 });
  } catch (error) {
    console.error("Failed to create database property:", error);
    return NextResponse.json({ error: "Failed to create database property" }, { status: 500 });
  }
}
