import { eq, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databases, databaseProperties } from "@/db/schema";
import { parseFormula } from "@/lib/database-formula";
import { DATABASE_PROPERTY_TYPES } from "@/lib/database-property";
import { buttonOptionsSchema } from "@/lib/database-button";
import { validateButtonActionDefinitions } from "@/lib/database-button-server";
import { apiErrorResponse } from "@/lib/api-log";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(DATABASE_PROPERTY_TYPES).default("text"),
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
    let propertyOptions = parsed.data.options ?? {};
    if (parsed.data.type === "button") {
      const actions = buttonOptionsSchema.safeParse(parsed.data.options ?? {});
      if (!actions.success) {
        return NextResponse.json({ error: "A button needs at least one valid action" }, { status: 400 });
      }
      const actionError = await validateButtonActionDefinitions(id, actions.data.actions);
      if (actionError) return NextResponse.json({ error: actionError }, { status: 400 });
      propertyOptions = { actions: actions.data.actions };
    }
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
    if (parsed.data.type === "formula") {
      const expression = parsed.data.options?.expression;
      if (typeof expression !== "string" || !expression.trim()) {
        return NextResponse.json({ error: "Enter a formula" }, { status: 400 });
      }
      const parsedFormula = parseFormula(expression);
      if (!parsedFormula.ok) return NextResponse.json({ error: parsedFormula.error }, { status: 400 });
      const existingProperties = await db.select().from(databaseProperties).where(eq(databaseProperties.databaseId, id));
      const propertiesByName = new Map(existingProperties.map((property) => [property.name, property]));
      for (const reference of parsedFormula.references) {
        const referenced = propertiesByName.get(reference);
        if (!referenced) {
          return NextResponse.json({ error: `No property named “${reference}” in this database` }, { status: 400 });
        }
        if (referenced.type !== "number" && referenced.type !== "rollup") {
          return NextResponse.json({ error: "Formulas can reference number and rollup properties" }, { status: 400 });
        }
      }
    }
    const [maxOrder] = await db.select({ value: max(databaseProperties.sortOrder) }).from(databaseProperties).where(eq(databaseProperties.databaseId, id));
    const [property] = await db.insert(databaseProperties).values({
      databaseId: id,
      name: parsed.data.name,
      type: parsed.data.type,
      options: propertyOptions,
      sortOrder: (maxOrder?.value ?? -1) + 1,
    }).returning();
    return NextResponse.json(property, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to create database property", error, { status: 500, logMessage: "Failed to create database property:" });
  }
}
