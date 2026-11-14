
import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull, max, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { databaseRecords, pageRevisions, pages } from "@/db/schema";
import { isAllowedMediaUrl } from "@/lib/media";
import { subtreeIds } from "@/db/page-tree";
import { apiErrorResponse } from "@/lib/api-log";

type Context = {
  params: Promise<{ id: string }>;
};

const idSchema = z.string().uuid();

const updatePageSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(2_000_000).optional(),
  contentJson: z.record(z.string(), z.unknown()).optional(),
  parentId: z.string().uuid().nullable().optional(),
  isFavorite: z.boolean().optional(),
  icon: z.string().max(32).nullable().optional(),
  coverImageUrl: z.string().trim().max(2048).nullable().optional(),
  coverPosition: z.number().int().min(0).max(100).optional(),
  selectedText: z.string().max(2_000).nullable().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: "Provide at least one field to update" },
).refine(
  (data) => !data.coverImageUrl || isAllowedMediaUrl(data.coverImageUrl),
  { message: "Cover image must be an uploaded file or an http(s) URL" },
);

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;

  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  try {
    const [page] = await db
      .select()
      .from(pages)
      .where(and(eq(pages.id, id), isNull(pages.deletedAt)))
      .limit(1);

    if (!page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    return NextResponse.json(page);
  } catch (error) {
    return apiErrorResponse(request, "Failed to fetch page", error, { status: 500, logMessage: "Failed to fetch page:" });
  }
}


export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;

  if (!idSchema.safeParse(id).success) {
    return NextResponse.json(
      { error: "Invalid page ID" },
      { status: 400 }
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = updatePageSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid page update" },
      { status: 400 }
    );
  }

  try {
  // Confirm the page exists without reading its body. Every save touches this
  // row, and a favorite, cover, icon, quote, or move save never needs the text.
    const [existingPage] = await db
    .select({ id: pages.id, parentId: pages.parentId })
    .from(pages)
    .where(and(eq(pages.id, id), isNull(pages.deletedAt)))
    .limit(1);

  if (!existingPage) {
    return NextResponse.json(
      { error: "Page not found" },
      { status: 404 }
    );
  }

  // An emptied quote is stored as no quote at all, so clearing the field on a
  // page means the same thing as never capturing a passage.
  const updates = {
    ...parsed.data,
    ...(parsed.data.selectedText !== undefined
      ? { selectedText: parsed.data.selectedText?.trim() || null }
      : {}),
  };

  // Validate a requested parent change.
  if (parsed.data.parentId !== undefined && parsed.data.parentId !== null) {
    const newParentId = parsed.data.parentId;

    // A page cannot be its own parent.
    if (newParentId === id) {
      return NextResponse.json(
        { error: "A page cannot be its own parent." },
        { status: 400 }
      );
    }

    const [parentPage] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.id, newParentId))
      .limit(1);

    if (!parentPage) {
      return NextResponse.json(
        { error: "Parent page not found." },
        { status: 404 }
      );
    }

    // One recursive query answers "is the new parent inside this page's
    // subtree?" without reading every page in the workspace.
    const descendants = new Set(await subtreeIds(db, id));

    // Prevent moving a page underneath one of its descendants.
    if (descendants.has(newParentId)) {
      return NextResponse.json(
        { error: "Cannot move a page inside its own descendants." },
        { status: 400 }
      );
    }
  }

     // Determine whether the page is actually changing parents.
  const isMoving =
    parsed.data.parentId !== undefined &&
    parsed.data.parentId !== existingPage.parentId;

  let nextSortOrder: number | undefined;

  if (isMoving) {
    const newParentId = parsed.data.parentId ?? null;

    // Find the highest sort position among the destination's siblings.
    const [result] = await db
      .select({
        maxSortOrder: max(pages.sortOrder),
      })
      .from(pages)
      .where(
        newParentId
          ? eq(pages.parentId, newParentId)
          : isNull(pages.parentId)
      );

    nextSortOrder = (result?.maxSortOrder ?? -1) + 1;
  }

  const page = await db.transaction(async (tx) => {
    // A revision snapshots the row being replaced, so the comparison and the
    // copy both happen in one statement. A save reads the old body only when a
    // revision is actually due, and that body never has to travel through Node.
    const changedFields = [
      parsed.data.title !== undefined ? sql`title IS DISTINCT FROM ${parsed.data.title}` : undefined,
      parsed.data.content !== undefined ? sql`content IS DISTINCT FROM ${parsed.data.content}` : undefined,
      parsed.data.contentJson !== undefined
        ? sql`content_json IS DISTINCT FROM ${JSON.stringify(parsed.data.contentJson)}::jsonb`
        : undefined,
    ].filter((clause): clause is SQL => clause !== undefined);

    if (changedFields.length > 0) {
      // One snapshot a minute keeps edit bursts from filling the history. The
      // window is checked in the same statement, so a save that changes
      // nothing, or arrives too soon after the last snapshot, reads nothing.
      const inserted = await tx.execute(sql`
        INSERT INTO page_revisions (page_id, title, content, content_json)
        SELECT id, title, content, content_json
        FROM pages
        WHERE id = ${id}
          AND (${sql.join(changedFields, sql` OR `)})
          AND NOT EXISTS (
            SELECT 1 FROM page_revisions
            WHERE page_id = ${id} AND created_at > now() - interval '60 seconds'
          )
        RETURNING id
      `);

      if (inserted.rows.length > 0) {
        const oldRevisions = await tx
          .select({ id: pageRevisions.id })
          .from(pageRevisions)
          .where(eq(pageRevisions.pageId, id))
          .orderBy(desc(pageRevisions.createdAt))
          .offset(100);

        if (oldRevisions.length) {
          await tx.delete(pageRevisions).where(inArray(pageRevisions.id, oldRevisions.map((revision) => revision.id)));
        }
      }
    }

    const [updatedPage] = await tx
      .update(pages)
      .set({
        ...updates,
        ...(nextSortOrder !== undefined ? { sortOrder: nextSortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(pages.id, id))
      .returning();

    // A record's page keeps the record title in step so the full record view
    // and the standalone page never disagree.
    if (parsed.data.title !== undefined) {
      await tx
        .update(databaseRecords)
        .set({ title: parsed.data.title, updatedAt: new Date() })
        // Comparing in the update keeps an unchanged title from touching the
        // record's own timestamp, without reading the old title first.
        .where(and(eq(databaseRecords.pageId, id), ne(databaseRecords.title, parsed.data.title)));
    }

    return updatedPage;
  });

  return NextResponse.json(page);
  } catch (error) {
    return apiErrorResponse(request, "Failed to update page", error, { status: 500, logMessage: "Failed to update page:" });
  }
}



export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;

  if (!idSchema.safeParse(id).success) {
    return NextResponse.json(
      { error: "Invalid page ID" },
      { status: 400 }
    );
  }

  try {
    const trashedCount = await db.transaction(async (tx) => {
      // Trashing a page trashes its whole subtree so children are never
      // left pointing at a page that no longer renders.
      const ids = await subtreeIds(tx, id);
      if (ids.length === 0) return null;

      await tx
        .update(pages)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(inArray(pages.id, ids));

      return ids.length;
    });

    if (trashedCount === null) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, trashedCount });
  } catch (error) {
    return apiErrorResponse(request, "Failed to delete page", error, { status: 500, logMessage: "Failed to delete page:" });
  }
}
