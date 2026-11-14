import { and, desc, eq, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import {
  databaseRecords,
  databases,
  pageLinks,
  pageRecordLinks,
  pages,
  pageTags,
  tags,
} from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import {
  rankRelatedPages,
  type RelatedPageCandidate,
  type RelatedSignals,
} from "@/lib/related-pages";

type Context = { params: Promise<{ id: string }> };

// The candidate side of a link or record signal, as opposed to the page being
// viewed. Ranking a candidate needs its own state and recency, not the target's.
const sourcePage = alias(pages, "source_page");
const idSchema = z.string().uuid();
const RELATED_LIMIT = 5;

// Sharing one tag with a large part of the workspace is a weak hint, so the tag
// signal ranks its candidates in SQL and reads only this many of them.
const RELATED_CANDIDATE_WINDOW = 60;

/**
 * Suggests pages connected by signals the workspace already stores: shared
 * tags, pages both link to, and records both are linked to. Suggestions are
 * read-only hints; nothing is linked until the user asks for it.
 */
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  try {
    const [page] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, id), isNull(pages.deletedAt)))
      .limit(1);
    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const [tagRows, outgoingRows, recordRows, connections] = await Promise.all([
      db
        .select({ tagId: tags.id, name: tags.name })
        .from(pageTags)
        .innerJoin(tags, eq(pageTags.tagId, tags.id))
        .where(eq(pageTags.pageId, id)),
      db
        .select({ id: pages.id, title: pages.title })
        .from(pageLinks)
        .innerJoin(pages, eq(pageLinks.targetPageId, pages.id))
        .where(and(eq(pageLinks.sourcePageId, id), isNull(pages.deletedAt))),
      db
        .select({
          id: databaseRecords.id,
          title: databaseRecords.title,
          databaseName: databases.name,
        })
        .from(pageRecordLinks)
        .innerJoin(databaseRecords, eq(pageRecordLinks.recordId, databaseRecords.id))
        .innerJoin(databases, eq(databaseRecords.databaseId, databases.id))
        .where(eq(pageRecordLinks.pageId, id)),
      // Either direction of a link is already visible in the connections panel,
      // so a page that is linked to or from here is not a suggestion.
      db
        .select({
          sourcePageId: pageLinks.sourcePageId,
          targetPageId: pageLinks.targetPageId,
        })
        .from(pageLinks)
        .where(or(eq(pageLinks.sourcePageId, id), eq(pageLinks.targetPageId, id))),
    ]);

    const tagIds = tagRows.map((row) => row.tagId);
    const targetIds = outgoingRows.map((row) => row.id);
    const recordIds = recordRows.map((row) => row.id);
    if (tagIds.length === 0 && targetIds.length === 0 && recordIds.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    const [tagMatches, linkMatches, recordMatches] = await Promise.all([
      // One broad tag can be shared with thousands of pages, so the shared tags
      // are counted per candidate in the database and only the strongest window
      // is read. These filters match the candidate query below, so a page that
      // would be dropped there never takes up a window slot.
      tagIds.length > 0
        ? db
            .select({
              pageId: pageTags.pageId,
              names: sql<string[]>`array_agg(${tags.name} ORDER BY ${tags.name})`,
            })
            .from(pageTags)
            .innerJoin(tags, eq(pageTags.tagId, tags.id))
            .innerJoin(pages, eq(pages.id, pageTags.pageId))
            .where(
              and(
                inArray(pageTags.tagId, tagIds),
                ne(pageTags.pageId, id),
                isNull(pages.deletedAt),
                eq(pages.isInbox, false),
                notExists(
                  db
                    .select({ id: databaseRecords.id })
                    .from(databaseRecords)
                    .where(eq(databaseRecords.pageId, pages.id)),
                ),
              ),
            )
            .groupBy(pageTags.pageId, pages.updatedAt)
            .orderBy(desc(sql`count(*)`), desc(pages.updatedAt))
            .limit(RELATED_CANDIDATE_WINDOW)
        : Promise.resolve([]),
      // A hub page is linked from all over the workspace, so the pages that
      // link to it are grouped per candidate, filtered before they take up a
      // slot, and read only up to the same window as the tag signal.
      targetIds.length > 0
        ? db
            .select({
              pageId: pageLinks.sourcePageId,
              targets: sql<{ id: string; title: string }[]>`json_agg(
                json_build_object('id', ${pages.id}, 'title', ${pages.title})
                ORDER BY ${pages.title}
              )`,
            })
            .from(pageLinks)
            .innerJoin(pages, eq(pageLinks.targetPageId, pages.id))
            .innerJoin(sourcePage, eq(pageLinks.sourcePageId, sourcePage.id))
            .where(
              and(
                inArray(pageLinks.targetPageId, targetIds),
                ne(pageLinks.sourcePageId, id),
                isNull(pages.deletedAt),
                isNull(sourcePage.deletedAt),
                eq(sourcePage.isInbox, false),
                notExists(
                  db
                    .select({ id: databaseRecords.id })
                    .from(databaseRecords)
                    .where(eq(databaseRecords.pageId, sourcePage.id)),
                ),
              ),
            )
            .groupBy(pageLinks.sourcePageId, sourcePage.updatedAt)
            .orderBy(desc(sql`count(*)`), desc(sourcePage.updatedAt))
            .limit(RELATED_CANDIDATE_WINDOW)
        : Promise.resolve([]),
      // Records fan out the same way when one record is linked from many pages.
      recordIds.length > 0
        ? db
            .select({
              pageId: pageRecordLinks.pageId,
              records: sql<{ id: string; title: string; databaseName: string }[]>`json_agg(
                json_build_object('id', ${databaseRecords.id}, 'title', ${databaseRecords.title}, 'databaseName', ${databases.name})
                ORDER BY ${databaseRecords.title}
              )`,
            })
            .from(pageRecordLinks)
            .innerJoin(databaseRecords, eq(pageRecordLinks.recordId, databaseRecords.id))
            .innerJoin(databases, eq(databaseRecords.databaseId, databases.id))
            .innerJoin(sourcePage, eq(pageRecordLinks.pageId, sourcePage.id))
            .where(
              and(
                inArray(pageRecordLinks.recordId, recordIds),
                ne(pageRecordLinks.pageId, id),
                isNull(sourcePage.deletedAt),
                eq(sourcePage.isInbox, false),
                notExists(
                  db
                    .select({ id: databaseRecords.id })
                    .from(databaseRecords)
                    .where(eq(databaseRecords.pageId, sourcePage.id)),
                ),
              ),
            )
            .groupBy(pageRecordLinks.pageId, sourcePage.updatedAt)
            .orderBy(desc(sql`count(*)`), desc(sourcePage.updatedAt))
            .limit(RELATED_CANDIDATE_WINDOW)
        : Promise.resolve([]),
    ]);

    const connectedIds = new Set<string>([id]);
    for (const connection of connections) {
      connectedIds.add(connection.sourcePageId);
      connectedIds.add(connection.targetPageId);
    }

    const signalsByPage = new Map<string, RelatedSignals>();
    const signalsFor = (pageId: string): RelatedSignals => {
      const existing = signalsByPage.get(pageId);
      if (existing) return existing;
      const created: RelatedSignals = { tags: [], pageLinks: [], records: [] };
      signalsByPage.set(pageId, created);
      return created;
    };

    for (const match of tagMatches) {
      if (connectedIds.has(match.pageId)) continue;
      signalsFor(match.pageId).tags.push(...match.names);
    }
    for (const match of linkMatches) {
      if (connectedIds.has(match.pageId)) continue;
      signalsFor(match.pageId).pageLinks.push(...match.targets);
    }
    for (const match of recordMatches) {
      if (connectedIds.has(match.pageId)) continue;
      signalsFor(match.pageId).records.push(...match.records);
    }

    const candidateIds = [...signalsByPage.keys()];
    if (candidateIds.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    // Inbox captures and record pages stay out of navigation, and suggestions
    // follow the same rule; they are queues, not related reading.
    const candidateRows = await db
      .select({ id: pages.id, title: pages.title })
      .from(pages)
      .where(
        and(
          inArray(pages.id, candidateIds),
          isNull(pages.deletedAt),
          eq(pages.isInbox, false),
          notExists(
            db
              .select({ id: databaseRecords.id })
              .from(databaseRecords)
              .where(eq(databaseRecords.pageId, pages.id)),
          ),
        ),
      );

    const candidates: RelatedPageCandidate[] = candidateRows.map((row) => ({
      id: row.id,
      title: row.title,
      signals: signalsByPage.get(row.id) ?? { tags: [], pageLinks: [], records: [] },
    }));

    return NextResponse.json({ suggestions: rankRelatedPages(candidates, RELATED_LIMIT) });
  } catch (error) {
    return apiErrorResponse(request, "Failed to load related pages", error, {
      status: 500,
      logMessage: "Failed to load related pages:",
    });
  }
}
