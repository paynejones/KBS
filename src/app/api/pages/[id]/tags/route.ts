import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pageTags, pages, tags } from "@/db/schema";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-log";

const pageIdSchema = z.string().uuid();

const assignTagSchema = z.object({
  tagId: z.string().uuid(),
});

const removeTagSchema = z.object({
  tagId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  { params }: RouteContext
) {
  try {
    const { id } = await params;

    if (!pageIdSchema.safeParse(id).success) {
      return Response.json({ error: "Invalid page ID." }, { status: 400 });
    }

    const results = await db
      .select({
        id: tags.id,
        name: tags.name,
      })
      .from(pageTags)
      .innerJoin(tags, eq(pageTags.tagId, tags.id))
      .where(eq(pageTags.pageId, id));

    return Response.json(results);
  } catch (error) {
    return apiErrorResponse(request, "Failed to fetch page tags.", error, { status: 500, logMessage: "Failed to fetch page tags:" });
  }
}

export async function POST(
  request: Request,
  { params }: RouteContext
) {
  try {
    const { id } = await params;

    if (!pageIdSchema.safeParse(id).success) {
      return Response.json({ error: "Invalid page ID." }, { status: 400 });
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = assignTagSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: "A valid tag ID is required." },
        { status: 400 }
      );
    }

    const [page] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);

    if (!page) {
      return Response.json(
        { error: "Page not found." },
        { status: 404 }
      );
    }

    const [tag] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(eq(tags.id, parsed.data.tagId))
      .limit(1);

    if (!tag) {
      return Response.json(
        { error: "Tag not found." },
        { status: 404 }
      );
    }

    await db
      .insert(pageTags)
      .values({
        pageId: id,
        tagId: parsed.data.tagId,
      })
      .onConflictDoNothing();

    return Response.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to assign tag.", error, { status: 500, logMessage: "Failed to assign tag:" });
  }
}

export async function DELETE(
  request: Request,
  { params }: RouteContext
) {
  try {
    const { id } = await params;

    if (!pageIdSchema.safeParse(id).success) {
      return Response.json({ error: "Invalid page ID." }, { status: 400 });
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = removeTagSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: "A valid tag ID is required." },
        { status: 400 }
      );
    }

    await db
      .delete(pageTags)
      .where(
        and(
          eq(pageTags.pageId, id),
          eq(pageTags.tagId, parsed.data.tagId)
        )
      );

    return Response.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to remove tag.", error, { status: 500, logMessage: "Failed to remove tag:" });
  }
}
