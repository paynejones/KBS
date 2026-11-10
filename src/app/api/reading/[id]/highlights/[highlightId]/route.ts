import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { readingHighlights } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

type RouteContext = {
  params: Promise<{ id: string; highlightId: string }>;
};

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id, highlightId } = await params;

    if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(highlightId).success) {
      return Response.json({ error: "Invalid highlight ID." }, { status: 400 });
    }

    const deleted = await db
      .delete(readingHighlights)
      .where(and(
        eq(readingHighlights.id, highlightId),
        eq(readingHighlights.itemId, id),
      ))
      .returning({ id: readingHighlights.id });

    if (deleted.length === 0) {
      return Response.json({ error: "Highlight not found." }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to remove the highlight.", error, { status: 500, logMessage: "Failed to remove the highlight:" });
  }
}
