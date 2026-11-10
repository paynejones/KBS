import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { readingItems } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import { normalizeReadingUrl, READING_KINDS, READING_STATUSES } from "@/lib/reading";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const updateReadingItemSchema = z
  .object({
    kind: z.enum(READING_KINDS).optional(),
    status: z.enum(READING_STATUSES).optional(),
    author: z.string().trim().max(120).optional(),
    url: z.string().trim().max(2048).nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    { message: "Nothing to update." },
  );

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;

    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: "Invalid reading item ID." }, { status: 400 });
    }

    const parsed = updateReadingItemSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "Nothing to update." }, { status: 400 });
    }

    let url: string | null | undefined;
    if (parsed.data.url !== undefined) {
      const normalized = normalizeReadingUrl(parsed.data.url);
      if (!normalized.ok) {
        return Response.json({ error: "Enter a valid web address." }, { status: 400 });
      }
      url = normalized.url;
    }

    const [updated] = await db
      .update(readingItems)
      .set({
        ...(parsed.data.kind === undefined ? {} : { kind: parsed.data.kind }),
        ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        ...(parsed.data.author === undefined ? {} : { author: parsed.data.author }),
        ...(url === undefined ? {} : { url }),
        updatedAt: new Date(),
      })
      .where(eq(readingItems.id, id))
      .returning();

    if (!updated) {
      return Response.json({ error: "Reading item not found." }, { status: 404 });
    }

    return Response.json({
      id: updated.id,
      pageId: updated.pageId,
      kind: updated.kind,
      status: updated.status,
      author: updated.author,
      url: updated.url,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to update the reading item.", error, { status: 500, logMessage: "Failed to update the reading item:" });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;

    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: "Invalid reading item ID." }, { status: 400 });
    }

    // Only the tracking row and its highlights go away: the notes page it
    // created stays in Pages, and trashing that page is a separate choice.
    const deleted = await db
      .delete(readingItems)
      .where(eq(readingItems.id, id))
      .returning({ id: readingItems.id });

    if (deleted.length === 0) {
      return Response.json({ error: "Reading item not found." }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to remove the reading item.", error, { status: 500, logMessage: "Failed to remove the reading item:" });
  }
}
