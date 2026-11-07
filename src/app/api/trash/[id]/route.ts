import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { attachmentIdsInText } from "@/lib/media";
import { removeUnreferencedAttachments } from "@/lib/attachment-cleanup";
import { collectSubtreeIds } from "@/lib/trash";
import { apiErrorResponse } from "@/lib/api-log";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  }

  try {
    const removal = await db.transaction(async (tx) => {
      const hierarchy = await tx
        .select({ id: pages.id, parentId: pages.parentId, deletedAt: pages.deletedAt })
        .from(pages);

      const page = hierarchy.find((row) => row.id === id);
      if (!page || !page.deletedAt) return null;

      const ids = collectSubtreeIds(hierarchy, id);
      const rows = await tx
        .select({
          content: pages.content,
          contentJson: pages.contentJson,
          coverImageUrl: pages.coverImageUrl,
          captureAttachment: pages.captureAttachment,
        })
        .from(pages)
        .where(inArray(pages.id, ids));

      const candidates = new Set<string>();
      for (const row of rows) {
        for (const attachmentId of attachmentIdsInText(row.content)) candidates.add(attachmentId);
        for (const attachmentId of attachmentIdsInText(JSON.stringify(row.contentJson))) {
          candidates.add(attachmentId);
        }
        for (const attachmentId of attachmentIdsInText(row.coverImageUrl)) candidates.add(attachmentId);
        for (const attachmentId of attachmentIdsInText(JSON.stringify(row.captureAttachment))) {
          candidates.add(attachmentId);
        }
      }

      // Revisions, tags, links, and embed references cascade or detach here.
      await tx.delete(pages).where(inArray(pages.id, ids));

      return { deletedCount: ids.length, candidates: Array.from(candidates) };
    });

    if (!removal) {
      return NextResponse.json({ error: "Page is not in the trash." }, { status: 404 });
    }

    // Only files that nothing else references are removed.
    const purged = await removeUnreferencedAttachments(removal.candidates);

    return NextResponse.json({
      success: true,
      deletedCount: removal.deletedCount,
      attachmentsRemoved: purged.removed,
      bytesFreed: purged.bytes,
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to delete page.", error, { status: 500, logMessage: "Failed to permanently delete page:" });
  }
}
