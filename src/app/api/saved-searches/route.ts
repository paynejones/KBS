import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { savedSearches, tags } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import {
  SAVED_SEARCH_NAME_LIMIT,
  SAVED_SEARCH_QUERY_LIMIT,
} from "@/lib/saved-searches";

const createSavedSearchSchema = z.object({
  name: z.string().trim().min(1).max(SAVED_SEARCH_NAME_LIMIT),
  query: z.string().trim().max(SAVED_SEARCH_QUERY_LIMIT).optional(),
  tagId: z.string().uuid().nullable().optional(),
  favoritesOnly: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    const rows = await db
      .select({
        id: savedSearches.id,
        name: savedSearches.name,
        query: savedSearches.query,
        tagId: savedSearches.tagId,
        tagName: tags.name,
        favoritesOnly: savedSearches.favoritesOnly,
        createdAt: savedSearches.createdAt,
      })
      .from(savedSearches)
      .leftJoin(tags, eq(savedSearches.tagId, tags.id))
      .orderBy(desc(savedSearches.createdAt), asc(savedSearches.name));

    return Response.json(rows);
  } catch (error) {
    return apiErrorResponse(request, "Failed to fetch saved searches.", error, { status: 500, logMessage: "Failed to fetch saved searches:" });
  }
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = createSavedSearchSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: `Give the collection a name of 1 to ${SAVED_SEARCH_NAME_LIMIT} characters and a search under ${SAVED_SEARCH_QUERY_LIMIT} characters.`,
        },
        { status: 400 },
      );
    }

    const tagId = parsed.data.tagId ?? null;
    let tagName: string | null = null;

    if (tagId) {
      const [tag] = await db
        .select({ id: tags.id, name: tags.name })
        .from(tags)
        .where(eq(tags.id, tagId))
        .limit(1);

      if (!tag) {
        return Response.json({ error: "Tag not found." }, { status: 404 });
      }
      tagName = tag.name;
    }

    const [created] = await db
      .insert(savedSearches)
      .values({
        name: parsed.data.name,
        query: parsed.data.query ?? "",
        tagId,
        favoritesOnly: parsed.data.favoritesOnly ?? false,
      })
      .returning();

    return Response.json({ ...created, tagName }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to save the search.", error, { status: 500, logMessage: "Failed to save the search:" });
  }
}
