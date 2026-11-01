import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { databases, databaseRecords, pages } from "@/db/schema";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query) return NextResponse.json({ pages: [], records: [] });
  if (query.length > 200) return NextResponse.json({ error: "Search query is too long" }, { status: 400 });

  try {
    const pattern = `%${query}%`;
    const [pageResults, recordResults] = await Promise.all([
      db.select({ id: pages.id, title: pages.title, updatedAt: pages.updatedAt })
        .from(pages)
        .where(or(ilike(pages.title, pattern), ilike(pages.content, pattern)))
        .orderBy(desc(pages.updatedAt))
        .limit(8),
      db.select({
        id: databaseRecords.id,
        title: databaseRecords.title,
        databaseId: databases.id,
        databaseName: databases.name,
      })
        .from(databaseRecords)
        .innerJoin(databases, eq(databaseRecords.databaseId, databases.id))
        .where(or(
          ilike(databaseRecords.title, pattern),
          sql`${databaseRecords.values}::text ILIKE ${pattern}`,
        ))
        .orderBy(desc(databaseRecords.updatedAt))
        .limit(8),
    ]);
    return NextResponse.json({ pages: pageResults, records: recordResults });
  } catch (error) {
    console.error("Global search failed:", error);
    return NextResponse.json({ error: "Search is unavailable right now" }, { status: 500 });
  }
}
