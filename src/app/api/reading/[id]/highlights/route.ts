import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { readingHighlights, readingItems } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const createHighlightSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  note: z.string().trim().max(2000).optional(),
});

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;

    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: "Invalid reading item ID." }, { status: 400 });
    }

    const parsed = createHighlightSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: "Paste a passage of 1 to 4000 characters." },
        { status: 400 },
      );
    }

    const [item] = await db
      .select({ id: readingItems.id })
      .from(readingItems)
      .where(eq(readingItems.id, id))
      .limit(1);

    if (!item) {
      return Response.json({ error: "Reading item not found." }, { status: 404 });
    }

    const [highlight] = await db
      .insert(readingHighlights)
      .values({
        itemId: id,
        text: parsed.data.text,
        note: parsed.data.note ?? "",
      })
      .returning();

    return Response.json({
      id: highlight.id,
      text: highlight.text,
      note: highlight.note,
      createdAt: highlight.createdAt.toISOString(),
    }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to save the highlight.", error, { status: 500, logMessage: "Failed to save the highlight:" });
  }
}
