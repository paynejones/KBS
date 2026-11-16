import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databases, databaseViews } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import { createRootPage } from "@/lib/database-page";

const createSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  try {
    return NextResponse.json(
      await db.select().from(databases).orderBy(desc(databases.updatedAt)),
    );
  } catch (error) {
    return apiErrorResponse(request, "Failed to load databases", error, { status: 500, logMessage: "Failed to load databases:" });
  }
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid database name" }, { status: 400 });
  }

  try {
    const database = await db.transaction(async (tx) => {
      const name = parsed.data.name ?? "Untitled database";
      // Every database owns a page that its record pages nest under, so the
      // page tree groups them instead of listing them at the root.
      const pageId = await createRootPage(tx, name);
      const [created] = await tx
        .insert(databases)
        .values({ name, pageId })
        .returning();
      await tx.insert(databaseViews).values({ databaseId: created.id, name: "All records", type: "table" });
      return created;
    });
    return NextResponse.json(database, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to create database", error, { status: 500, logMessage: "Failed to create database:" });
  }
}
