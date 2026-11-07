import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { collectSubtreeIds } from "@/lib/trash";
import { apiErrorResponse } from "@/lib/api-log";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  try {
    const restoredCount = await db.transaction(async (tx) => {
      const hierarchy = await tx
        .select({ id: pages.id, parentId: pages.parentId, deletedAt: pages.deletedAt })
        .from(pages);

      const page = hierarchy.find((row) => row.id === id);
      if (!page || !page.deletedAt) return null;

      const ids = collectSubtreeIds(hierarchy, id);
      const parent = page.parentId
        ? hierarchy.find((row) => row.id === page.parentId)
        : null;
      // A page whose parent is also trashed comes back at the top level so it
      // does not silently reappear inside a page that is still in the trash.
      const restoreParentId = parent && !parent.deletedAt ? page.parentId : null;

      await tx
        .update(pages)
        .set({
          deletedAt: null,
          updatedAt: new Date(),
          ...(restoreParentId !== page.parentId ? { parentId: restoreParentId } : {}),
        })
        .where(inArray(pages.id, ids));

      return ids.length;
    });

    if (restoredCount === null) {
      return NextResponse.json({ error: "Page is not in the trash." }, { status: 404 });
    }

    return NextResponse.json({ success: true, restoredCount });
  } catch (error) {
    return apiErrorResponse(request, "Failed to restore page.", error, { status: 500, logMessage: "Failed to restore page:" });
  }
}
