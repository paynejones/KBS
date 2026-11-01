import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pageTags, pages, tags } from "@/db/schema";
import { z } from "zod";

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
  _request: Request,
  { params }: RouteContext
) {
  try {
    const { id } = await params;

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
    console.error("Failed to fetch page tags:", error);

    return Response.json(
      { error: "Failed to fetch page tags." },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: RouteContext
) {
  try {
    const { id } = await params;

    const body = await request.json();
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
    console.error("Failed to assign tag:", error);

    return Response.json(
      { error: "Failed to assign tag." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: RouteContext
) {
  try {
    const { id } = await params;

    const body = await request.json();
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
    console.error("Failed to remove tag:", error);

    return Response.json(
      { error: "Failed to remove tag." },
      { status: 500 }
    );
  }
}