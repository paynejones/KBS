import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databaseProperties } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import { buttonOptionsSchema } from "@/lib/database-button";
import { validateButtonActionDefinitions } from "@/lib/database-button-server";

type Context = { params: Promise<{ id: string; propertyId: string }> };

/**
 * Button settings live entirely in the property's JSON options, so editing
 * actions does not touch stored record values or need a migration.
 */
export async function PATCH(request: Request, context: Context) {
  const { id, propertyId } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(propertyId).success) {
    return NextResponse.json({ error: "Invalid property ID" }, { status: 400 });
  }
  const parsed = buttonOptionsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A button needs at least one valid action" }, { status: 400 });
  }

  try {
    const [property] = await db.select().from(databaseProperties)
      .where(and(
        eq(databaseProperties.id, propertyId),
        eq(databaseProperties.databaseId, id),
      ))
      .limit(1);
    if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    if (property.type !== "button") {
      return NextResponse.json({ error: "Only button properties have actions" }, { status: 400 });
    }

    const actionError = await validateButtonActionDefinitions(id, parsed.data.actions);
    if (actionError) return NextResponse.json({ error: actionError }, { status: 400 });

    const [updated] = await db.update(databaseProperties)
      .set({ options: { ...property.options, actions: parsed.data.actions } })
      .where(eq(databaseProperties.id, propertyId))
      .returning();
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(request, "Failed to update button actions", error, {
      status: 500,
      logMessage: "Failed to update button actions:",
    });
  }
}
