
import { NextResponse } from "next/server";
import {
  and,
  inArray,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  max,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { databaseRecords, pages, pageTags, pageTemplates, tags } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

const createPageSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  parentId: z.string().uuid().nullable().optional(),
  content: z.string().max(2_000_000).optional(),
  contentJson: z.record(z.string(), z.unknown()).optional(),
  /** Seed the new page from a saved page template. */
  templateId: z.string().uuid().optional(),
  icon: z.string().max(32).nullable().optional(),
});

/**
 * Listings answer navigation, pickers, and dashboard summaries: they need a
 * page's identity and timestamps, never its editor body. Selecting whole rows
 * sent every page's `content` and `content_json` to the page tree on every
 * navigation, so a listing cost the size of the whole workspace.
 */
const listColumns = {
  id: pages.id,
  title: pages.title,
  parentId: pages.parentId,
  isFavorite: pages.isFavorite,
  createdAt: pages.createdAt,
  updatedAt: pages.updatedAt,
};

// A preview is a sentence, not the page: keep it short on both sides of the
// wire, and only read it for the few pages that display one.
const SNIPPET_LENGTH = 400;
const SNIPPET_PAGE_LIMIT = 25;
const ID_FILTER_LIMIT = 50;
// A bounded listing is a preview, not a download: collections ask for a few
// rows and a count, and the count reuses the same predicate.
const LIST_LIMIT_MAX = 200;

// The page browser shows one screenful at a time, so it asks for the order it
// displays and the dates it filters on; the default stays the sidebar's order.
function listingOrder(sort: string) {
  switch (sort) {
    case "updated-desc": return [desc(pages.updatedAt), asc(pages.id)];
    case "updated-asc": return [asc(pages.updatedAt), asc(pages.id)];
    case "created-desc": return [desc(pages.createdAt), asc(pages.id)];
    case "created-asc": return [asc(pages.createdAt), asc(pages.id)];
    case "title-asc": return [asc(pages.title), asc(pages.id)];
    case "title-desc": return [desc(pages.title), asc(pages.id)];
    default: return [asc(pages.sortOrder), asc(pages.title), asc(pages.id)];
  }
}

/** A listing date bound: an ISO instant, or null when absent or unreadable. */
function listingInstant(value: string | null): Date | null {
  if (!value) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

const snippetText = sql<string | null>`nullif(left(btrim(regexp_replace(regexp_replace(${pages.content}, '<[^>]*>', ' ', 'g'), '\\s+', ' ', 'g')), ${SNIPPET_LENGTH}), '')`;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim();
    const tagId = searchParams.get("tagId");
    const favoritesOnly = searchParams.get("favorite") === "true";
    const includeInbox = searchParams.get("includeInbox") === "true";
    // Record pages stay out of navigation and the page browser by default.
    // Direct page routes still open them, and pickers can opt back in.
    const includeRecordPages = searchParams.get("includeRecordPages") === "true";
    // A listing can be narrowed to known pages, and can carry a plain-text
    // preview for its most recently updated ones.
    const requestedIds = (searchParams.get("ids") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const requestedSnippets = Number(searchParams.get("snippets") ?? 0);
    const snippetLimit = Number.isFinite(requestedSnippets)
      ? Math.min(Math.max(Math.trunc(requestedSnippets), 0), SNIPPET_PAGE_LIMIT)
      : 0;

    const requestedLimit = Number(searchParams.get("limit") ?? 0);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.trunc(requestedLimit), LIST_LIMIT_MAX)
      : 0;
    const requestedOffset = Number(searchParams.get("offset") ?? 0);
    const offset = limit > 0 && Number.isFinite(requestedOffset) && requestedOffset > 0
      ? Math.trunc(requestedOffset)
      : 0;
    const sort = searchParams.get("sort") ?? "";
    // Sent as instants by the caller's calendar, so a date filter keeps the
    // same meaning it had when it ran in the browser.
    const updatedFrom = listingInstant(searchParams.get("updatedFrom"));
    const updatedThrough = listingInstant(searchParams.get("updatedThrough"));

    if (tagId && !z.string().uuid().safeParse(tagId).success) {
      return NextResponse.json({ error: "Invalid tag ID." }, { status: 400 });
    }

    if (requestedIds.length > ID_FILTER_LIMIT) {
      return NextResponse.json({ error: "Too many page IDs." }, { status: 400 });
    }

    if (requestedIds.some((id) => !z.string().uuid().safeParse(id).success)) {
      return NextResponse.json({ error: "Invalid page ID." }, { status: 400 });
    }

    // Built once so a bounded listing can be counted with the same predicate
    // instead of asking Postgres for every match.
    const filters = and(
      isNull(pages.deletedAt),
      requestedIds.length > 0 ? inArray(pages.id, requestedIds) : undefined,
      favoritesOnly ? eq(pages.isFavorite, true) : undefined,
      !includeInbox ? eq(pages.isInbox, false) : undefined,
      updatedFrom ? gte(pages.updatedAt, updatedFrom) : undefined,
      updatedThrough ? lte(pages.updatedAt, updatedThrough) : undefined,
      !includeRecordPages
        ? notExists(
            db
              .select({ id: databaseRecords.id })
              .from(databaseRecords)
              .where(eq(databaseRecords.pageId, pages.id))
          )
        : undefined,
      query
        ? or(
            ilike(pages.title, `%${query}%`),
            ilike(pages.content, `%${query}%`)
          )
        : undefined,

      tagId
        ? inArray(
            pages.id,
            db
              .select({ pageId: pageTags.pageId })
              .from(pageTags)
              .where(eq(pageTags.tagId, tagId))
          )
        : undefined
    );

    const listing = db
      .select(listColumns)
      .from(pages)
      .where(filters)
      .orderBy(...listingOrder(sort));

    const results = limit > 0 ? await listing.limit(limit).offset(offset) : await listing;
    const total = limit > 0
      ? (await db.select({ total: sql<number>`count(*)::int` }).from(pages).where(filters))[0]?.total ?? results.length
      : results.length;

    // Read tags only for the pages this listing returned. The join used to be
    // unfiltered, so every page-tag pair in the workspace was sent to Node and
    // thrown away for pages the filters had already excluded.
    const pageIds = results.map((page) => page.id);
    const tagResults =
      pageIds.length === 0
        ? []
        : await db
            .select({
              pageId: pageTags.pageId,
              id: tags.id,
              name: tags.name,
            })
            .from(pageTags)
            .innerJoin(tags, eq(pageTags.tagId, tags.id))
            .where(inArray(pageTags.pageId, pageIds));

    const tagsByPage = new Map<
      string,
      { id: string; name: string }[]
    >();

    for (const tag of tagResults) {
      const existing = tagsByPage.get(tag.pageId) ?? [];

      existing.push({
        id: tag.id,
        name: tag.name,
      });

      tagsByPage.set(tag.pageId, existing);
    }

    const recordPageIds = new Set(
      results.length === 0
        ? []
        : (
            await db
              .select({ pageId: databaseRecords.pageId })
              .from(databaseRecords)
              .where(inArray(databaseRecords.pageId, results.map((page) => page.id)))
          ).map((record) => record.pageId),
    );

    // Only the pages that display a preview are read, and only their first few
    // hundred characters leave the database. The body itself never travels.
    const snippets = new Map<string, string>();

    if (snippetLimit > 0 && results.length > 0) {
      const previewIds = [...results]
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .slice(0, snippetLimit)
        .map((page) => page.id);

      const previewRows = await db
        .select({ id: pages.id, snippet: snippetText })
        .from(pages)
        .where(inArray(pages.id, previewIds));

      for (const row of previewRows) {
        if (row.snippet) snippets.set(row.id, row.snippet);
      }
    }

    const pagesWithTags = results.map((page) => ({
      ...page,
      // Listings that opt into record pages can still separate them from
      // ordinary pages without another request.
      isRecordPage: recordPageIds.has(page.id),
      tags: tagsByPage.get(page.id) ?? [],
      ...(snippetLimit > 0 ? { snippet: snippets.get(page.id) ?? null } : {}),
    }));

    // A bounded listing reports how many pages it was taken from, so a caller
    // that only shows a preview still knows the whole collection's size.
    if (limit > 0) {
      return Response.json({ pages: pagesWithTags, total, offset });
    }

    return Response.json(pagesWithTags);
  } catch (error) {
    return apiErrorResponse(request, "Failed to fetch pages.", error, { status: 500, logMessage: "Failed to fetch pages:" });
  }
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = createPageSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid page data" },
      { status: 400 }
    );
  }

  const parentId = parsed.data.parentId ?? null;

  try {
  if (parentId) {
    const [parentPage] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, parentId), isNull(pages.deletedAt)))
      .limit(1);

    if (!parentPage) {
      return NextResponse.json(
        { error: "Parent page not found." },
        { status: 404 }
      );
    }
  }

  // Copying a template happens once, at creation: the page keeps its own
  // rows afterwards, so editing either side never changes the other.
  const template = parsed.data.templateId
    ? (await db
        .select({
          title: pageTemplates.title,
          content: pageTemplates.content,
          contentJson: pageTemplates.contentJson,
          icon: pageTemplates.icon,
        })
        .from(pageTemplates)
        .where(eq(pageTemplates.id, parsed.data.templateId))
        .limit(1))[0] ?? null
    : null;

  if (parsed.data.templateId && !template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  // Find the highest sort position among pages with the same parent.
  const [result] = await db
    .select({
      maxSortOrder: max(pages.sortOrder),
    })
    .from(pages)
    .where(
      parentId
        ? eq(pages.parentId, parentId)
        : isNull(pages.parentId)
    );

  const nextSortOrder = (result?.maxSortOrder ?? -1) + 1;

  const [page] = await db
    .insert(pages)
    .values({
      title: parsed.data.title ?? template?.title ?? "Untitled",
      parentId,
      sortOrder: nextSortOrder,
      content: parsed.data.content ?? template?.content ?? "",
      contentJson: parsed.data.contentJson ?? template?.contentJson ?? {},
      icon: parsed.data.icon ?? template?.icon ?? null,
    })
    .returning();

  return NextResponse.json(page, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to create page.", error, { status: 500, logMessage: "Failed to create page:" });
  }
}