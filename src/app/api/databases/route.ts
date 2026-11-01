import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { databases, databaseViews } from "@/db/schema";

const createSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});

export async function GET() {
  try {
    return NextResponse.json(
      await db.select().from(databases).orderBy(desc(databases.updatedAt)),
    );
  } catch (error) {
    console.error("Failed to load databases:", error);
    return NextResponse.json({ error: "Failed to load databases" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid database name" }, { status: 400 });
  }

  try {
    const database = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(databases)
        .values({ name: parsed.data.name ?? "Untitled database" })
        .returning();
      await tx.insert(databaseViews).values({ databaseId: created.id, name: "All records", type: "table" });
      return created;
    });
    return NextResponse.json(database, { status: 201 });
  } catch (error) {
    console.error("Failed to create database:", error);
    return NextResponse.json({ error: "Failed to create database" }, { status: 500 });
  }
}
