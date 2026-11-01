
import { NextResponse } from "next/server";
import { and, inArray, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pages, pageTags, tags  } from "@/db/schema";


const createPageSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim();
    const tagId = searchParams.get("tagId");

    // Fetch pages, including the existing search functionality.
    const results = await db
      .select()
      .from(pages)
      .where(
        and(
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
      .orderBy(desc(pages.updatedAt));

    // Fetch tag assignments for all pages.
    const tagResults = await db
      .select({
        pageId: pageTags.pageId,
        id: tags.id,
        name: tags.name,
      })
      .from(pageTags)
      .innerJoin(tags, eq(pageTags.tagId, tags.id));

    // Group tags by page ID.
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

    // Attach tags to each page.
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
      { status: 400 },
    );
  }

  const [page] = await db
    .insert(pages)
    .values({ title: parsed.data.title ?? "Untitled" })
    .returning();

  return NextResponse.json(page, { status: 201 });
}
