import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { savedSearches } from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;

    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: "Invalid saved search ID." }, { status: 400 });
    }

    // Deleting a collection only removes its filters; the pages it matched
    // were never owned by it.
    const deleted = await db
      .delete(savedSearches)
      .where(eq(savedSearches.id, id))
      .returning({ id: savedSearches.id });

    if (deleted.length === 0) {
      return Response.json({ error: "Saved search not found." }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (error) {
    return apiErrorResponse(request, "Failed to delete the saved search.", error, { status: 500, logMessage: "Failed to delete the saved search:" });
  }
}
