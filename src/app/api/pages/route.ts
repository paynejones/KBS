
import { NextResponse } from "next/server";
import {
  and,
  inArray,
  asc,
  eq,
  ilike,
  isNull,
  max,
  or,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pages, pageTags, pageTemplates, tags } from "@/db/schema";

const createPageSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  parentId: z.string().uuid().nullable().optional(),
  content: z.string().max(2_000_000).optional(),
  contentJson: z.record(z.string(), z.unknown()).optional(),
  /** Seed the new page from a saved page template. */
  templateId: z.string().uuid().optional(),
  icon: z.string().max(32).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim();
    const tagId = searchParams.get("tagId");
    const favoritesOnly = searchParams.get("favorite") === "true";
    const includeInbox = searchParams.get("includeInbox") === "true";

    if (tagId && !z.string().uuid().safeParse(tagId).success) {
      return NextResponse.json({ error: "Invalid tag ID." }, { status: 400 });
    }

    const results = await db
      .select()
      .from(pages)
      .where(
        and(
          isNull(pages.deletedAt),
          favoritesOnly ? eq(pages.isFavorite, true) : undefined,
          !includeInbox ? eq(pages.isInbox, false) : undefined,
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
        )
      )
      .orderBy(asc(pages.sortOrder), asc(pages.title));

    const tagResults = await db
      .select({
        pageId: pageTags.pageId,
        id: tags.id,
        name: tags.name,
      })
      .from(pageTags)
      .innerJoin(tags, eq(pageTags.tagId, tags.id));

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

    const pagesWithTags = results.map((page) => ({
      ...page,
      tags: tagsByPage.get(page.id) ?? [],
    }));

    return Response.json(pagesWithTags);
  } catch (error) {
    console.error("Failed to fetch pages:", error);

    return Response.json(
      { error: "Failed to fetch pages." },
      { status: 500 }
    );
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
    console.error("Failed to create page:", error);
    return NextResponse.json({ error: "Failed to create page." }, { status: 500 });
  }
}
