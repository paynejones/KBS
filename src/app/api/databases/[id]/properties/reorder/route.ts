import { asc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseProperties, databases } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({
  propertyIds: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * Saves the whole column order at once. The client sends every property id, so
 * moving one column is a single atomic request instead of a pair of partial
 * updates that could leave two properties claiming the same position.
 */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid database ID" }, { status: 400 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid property order" }, { status: 400 });

  const propertyIds = parsed.data.propertyIds;
  if (new Set(propertyIds).size !== propertyIds.length) {
    return NextResponse.json({ error: "A property appears more than once" }, { status: 400 });
  }

  try {
    const [database] = await db
      .select({ id: databases.id })
      .from(databases)
      .where(eq(databases.id, id))
      .limit(1);
    if (!database) return NextResponse.json({ error: "Database not found" }, { status: 404 });

    const existing = await db
      .select({ id: databaseProperties.id })
      .from(databaseProperties)
      .where(eq(databaseProperties.databaseId, id))
      .orderBy(asc(databaseProperties.sortOrder));
    const known = new Set(existing.map((property) => property.id));
    if (propertyIds.length !== existing.length || propertyIds.some((propertyId) => !known.has(propertyId))) {
      return NextResponse.json(
        { error: "The order must list every property in this database" },
        { status: 400 },
      );
    }

    // One statement for the whole order: every property already knows its new
    // position, so the positions travel with the ids.
    const reordered = propertyIds.map(
      (propertyId, position) => sql`(${propertyId}::uuid, ${position}::int)`,
    );

    await db.execute(sql`
      update database_properties as moved
      set sort_order = positions.position
      from (values ${sql.join(reordered, sql`, `)}) as positions(id, position)
      where moved.id = positions.id and moved.database_id = ${id}::uuid
    `);

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to reorder database properties", error, {
      status: 500,
      logMessage: "Failed to reorder database properties:",
    });
  }
}
