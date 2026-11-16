import { eq, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databases, databaseProperties } from "@/db/schema";
import { DATABASE_PROPERTY_TYPES } from "@/lib/database-property";
import { validatePropertyOptions } from "@/lib/database-property-server";
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

    // Every type checks its own options through the same validator an edit
    // uses, so a saved formula or rollup cannot differ by how it was written.
    const validated = await validatePropertyOptions(id, parsed.data.type, parsed.data.options ?? {});
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });

    const [maxOrder] = await db.select({ value: max(databaseProperties.sortOrder) }).from(databaseProperties).where(eq(databaseProperties.databaseId, id));
    const [property] = await db.insert(databaseProperties).values({
      databaseId: id,
      name: parsed.data.name,
      type: parsed.data.type,
      options: validated.options,
      sortOrder: (maxOrder?.value ?? -1) + 1,
    }).returning();
    return NextResponse.json(property, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to create database property", error, { status: 500, logMessage: "Failed to create database property:" });
  }
}
