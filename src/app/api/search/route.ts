import { and, desc, eq, ilike, isNull, or, sql, type SQLWrapper } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { databases, databaseRecords, pages } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

// Ranking has to see every candidate before it can order them, which is slow
// when a term matches most pages. Reading the newest matches first keeps this
// window bounded, so search never sorts a whole table on a keystroke.
const CANDIDATE_WINDOW = 32;

// Both kinds are fetched separately and merged on their scores, so each side
// only needs enough rows to fill the merged list.
const RESULTS_PER_KIND = 8;

// Where the term appears is worth a whole bucket stride, and the familiarity
// bonuses together stay below one stride, so a favorite body mention can never
// climb past a page named after the term.
const BUCKET_STRIDE = 4;
const FAVORITE_BONUS = 0.9;
const RECENCY_BONUS = 0.9;
const RECENCY_HALF_LIFE_DAYS = 30;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query) return NextResponse.json({ results: [] });
  if (query.length > 200) return NextResponse.json({ error: "Search query is too long" }, { status: 400 });

  try {
    const pattern = `%${query}%`;
    const prefix = `${query}%`;

    // One score makes pages and records comparable in a single list. Where the
    // term appears sets the large part — exact title (3 strides), title prefix
    // (2), title anywhere (1), body or property value only (0) — and trigram
    // similarity breaks ties inside a bucket. Favorites and freshly edited rows
    // then get a bounded nudge, so familiar results surface above equally
    // matching ones without ever reordering across match buckets.
    const relevance = (title: SQLWrapper, updatedAt: SQLWrapper, isFavorite?: SQLWrapper) => sql<number>`(
      (CASE
        WHEN lower(${title}) = lower(${query}) THEN 3
        WHEN ${title} ILIKE ${prefix} THEN 2
        WHEN ${title} ILIKE ${pattern} THEN 1
        ELSE 0
      END) * ${BUCKET_STRIDE}
      + similarity(${title}, ${query})
      + ${RECENCY_BONUS}::float8 / (1 + extract(epoch from (now() - ${updatedAt})) / ${RECENCY_HALF_LIFE_DAYS * 86400})
      ${isFavorite
        ? sql`+ CASE WHEN ${isFavorite} THEN ${FAVORITE_BONUS}::float8 ELSE 0::float8 END`
        : sql``}
    )`;

    const recentPages = db
      .select({
        id: pages.id,
        title: pages.title,
        updatedAt: pages.updatedAt,
        isFavorite: pages.isFavorite,
      })
      .from(pages)
      .where(and(isNull(pages.deletedAt), or(ilike(pages.title, pattern), ilike(pages.content, pattern))))
      .orderBy(desc(pages.updatedAt))
      .limit(CANDIDATE_WINDOW)
      .as("recent_pages");

    const [pageResults, recordResults] = await Promise.all([
      db.select({
        id: recentPages.id,
        title: recentPages.title,
        updatedAt: recentPages.updatedAt,
        score: relevance(recentPages.title, recentPages.updatedAt, recentPages.isFavorite),
        // Report the reason with the same pattern the filter used, so `%` and
        // `_` behave identically here and in the ranking buckets.
        match: sql<"title" | "content">`CASE WHEN ${recentPages.title} ILIKE ${pattern} THEN 'title' ELSE 'content' END`,
      })
        .from(recentPages)
        .orderBy(
          desc(relevance(recentPages.title, recentPages.updatedAt, recentPages.isFavorite)),
          desc(recentPages.updatedAt),
        )
        .limit(RESULTS_PER_KIND),
      db.select({
        id: databaseRecords.id,
        title: databaseRecords.title,
        updatedAt: databaseRecords.updatedAt,
        databaseId: databases.id,
        databaseName: databases.name,
        score: relevance(databaseRecords.title, databaseRecords.updatedAt),
        match: sql<"title" | "content">`CASE WHEN ${databaseRecords.title} ILIKE ${pattern} THEN 'title' ELSE 'content' END`,
      })
        .from(databaseRecords)
        .innerJoin(databases, eq(databaseRecords.databaseId, databases.id))
        .where(or(
          ilike(databaseRecords.title, pattern),
          sql`${databaseRecords.values}::text ILIKE ${pattern}`,
        ))
        // Records have no favorite flag of their own, so only their titles and
        // recency move them within a bucket.
        .orderBy(
          desc(relevance(databaseRecords.title, databaseRecords.updatedAt)),
          desc(databaseRecords.updatedAt),
        )
        .limit(RESULTS_PER_KIND),
    ]);

    const results = [
      ...pageResults.map((page) => ({
        type: "page" as const,
        id: page.id,
        title: page.title,
        updatedAt: page.updatedAt,
        score: Number(page.score),
        match: page.match,
      })),
      ...recordResults.map((record) => ({
        type: "record" as const,
        id: record.id,
        title: record.title,
        updatedAt: record.updatedAt,
        databaseId: record.databaseId,
        databaseName: record.databaseName,
        score: Number(record.score),
        match: record.match,
      })),
    ].sort((left, right) => right.score - left.score || right.updatedAt.getTime() - left.updatedAt.getTime());

    return NextResponse.json({ results });
  } catch (error) {
    return apiErrorResponse(request, "Search is unavailable right now", error, { status: 500, logMessage: "Global search failed:" });
  }
}
