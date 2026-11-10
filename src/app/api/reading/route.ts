import { asc, desc, eq, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pages, readingHighlights, readingItems } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import {
  normalizeReadingUrl,
  READING_KINDS,
  READING_STATUSES,
  type ReadingHighlight,
  type ReadingKind,
  type ReadingStatus,
} from "@/lib/reading";

const createReadingItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(READING_KINDS).optional(),
  status: z.enum(READING_STATUSES).optional(),
  author: z.string().trim().max(120).optional(),
  url: z.string().trim().max(2048).optional(),
});

export async function GET(request: Request) {
  try {
    const [rows, highlightRows] = await Promise.all([
      db.select({
        id: readingItems.id,
        pageId: readingItems.pageId,
        title: pages.title,
        kind: readingItems.kind,
        status: readingItems.status,
        author: readingItems.author,
        url: readingItems.url,
        updatedAt: readingItems.updatedAt,
      })
        .from(readingItems)
        .innerJoin(pages, eq(readingItems.pageId, pages.id))
        // A trashed notes page hides its item until the page is restored.
        .where(isNull(pages.deletedAt))
        .orderBy(desc(readingItems.updatedAt)),
      db.select({
        id: readingHighlights.id,
        itemId: readingHighlights.itemId,
        text: readingHighlights.text,
        note: readingHighlights.note,
        createdAt: readingHighlights.createdAt,
      })
        .from(readingHighlights)
        .orderBy(asc(readingHighlights.createdAt)),
    ]);

    const highlightsByItem = new Map<string, ReadingHighlight[]>();
    for (const highlight of highlightRows) {
      highlightsByItem.set(highlight.itemId, [
        ...(highlightsByItem.get(highlight.itemId) ?? []),
        {
          id: highlight.id,
          text: highlight.text,
          note: highlight.note,
          createdAt: highlight.createdAt.toISOString(),
        },
      ]);
    }

    return Response.json(rows.map((row) => ({
      id: row.id,
      pageId: row.pageId,
      title: row.title,
      kind: row.kind as ReadingKind,
      status: row.status as ReadingStatus,
      author: row.author,
      url: row.url,
      updatedAt: row.updatedAt.toISOString(),
      highlights: highlightsByItem.get(row.id) ?? [],
    })));
  } catch (error) {
    return apiErrorResponse(request, "Failed to fetch the reading list.", error, { status: 500, logMessage: "Failed to fetch the reading list:" });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createReadingItemSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return Response.json(
        { error: "Give the item a title of 1 to 200 characters." },
        { status: 400 },
      );
    }

    const url = normalizeReadingUrl(parsed.data.url);
    if (!url.ok) {
      return Response.json({ error: "Enter a valid web address." }, { status: 400 });
    }

    const kind = parsed.data.kind ?? "article";
    const status = parsed.data.status ?? "to-read";

    // The item and its notes page are created together so an item can never
    // exist without somewhere to write.
    const created = await db.transaction(async (tx) => {
      const [pageOrder] = await tx
        .select({ value: max(pages.sortOrder) })
        .from(pages)
        .where(isNull(pages.parentId));

      const [page] = await tx
        .insert(pages)
        .values({
          title: parsed.data.title,
          sortOrder: (pageOrder?.value ?? -1) + 1,
        })
        .returning({ id: pages.id, title: pages.title });

      const [item] = await tx
        .insert(readingItems)
        .values({
          pageId: page.id,
          kind,
          status,
          author: parsed.data.author ?? "",
          url: url.url,
        })
        .returning();

      return { ...item, title: page.title };
    });

    return Response.json({
      id: created.id,
      pageId: created.pageId,
      title: created.title,
      kind: created.kind as ReadingKind,
      status: created.status as ReadingStatus,
      author: created.author,
      url: created.url,
      updatedAt: created.updatedAt.toISOString(),
      highlights: [],
    }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to add the reading item.", error, { status: 500, logMessage: "Failed to add the reading item:" });
  }
}
