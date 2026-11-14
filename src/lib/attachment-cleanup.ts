import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { attachmentReferences, attachments } from "@/db/schema";
import { removeAttachmentFile } from "@/lib/attachment-store";

export type OrphanedAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: Date;
};

/**
 * Every attachment id still referenced by page content, page covers, captured
 * inbox files, page revisions, database record values, or database templates.
 *
 * Revisions are included on purpose: deleting a file that only an older
 * revision uses would break restoring that revision. Trashed pages keep their
 * files for the same reason — a restored page has to find its images again, so
 * nothing here filters on `deleted_at`.
 *
 * The rows come from `attachment_references`, which database triggers keep in
 * step with the documents, so answering this never opens a page body.
 */
export async function referencedAttachmentIdSet(): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ id: attachmentReferences.attachmentId })
    .from(attachmentReferences);

  return new Set(rows.map((row) => row.id));
}

export async function listOrphanedAttachments(): Promise<OrphanedAttachment[]> {
  const [rows, referenced] = await Promise.all([
    db.select().from(attachments),
    referencedAttachmentIdSet(),
  ]);

  return rows
    .filter((row) => !referenced.has(row.id))
    .map((row) => ({
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
      createdAt: row.createdAt,
    }));
}

/**
 * Deletes stored files for the given attachment ids when nothing else
 * references them. Used after a page is permanently deleted.
 */
export async function removeUnreferencedAttachments(candidateIds: string[]) {
  const unique = Array.from(new Set(candidateIds));
  if (unique.length === 0) return { removed: 0, bytes: 0 };

  const referenced = await referencedAttachmentIdSet();
  const removable = unique.filter((id) => !referenced.has(id));
  if (removable.length === 0) return { removed: 0, bytes: 0 };

  const rows = await db
    .select()
    .from(attachments)
    .where(inArray(attachments.id, removable));

  for (const row of rows) {
    await removeAttachmentFile(row.id);
  }
  if (rows.length > 0) {
    await db.delete(attachments).where(inArray(attachments.id, rows.map((row) => row.id)));
  }

  return { removed: rows.length, bytes: rows.reduce((total, row) => total + row.size, 0) };
}

/** Removes every attachment that no page, revision, record, or template references. */
export async function removeOrphanedAttachments() {
  const orphans = await listOrphanedAttachments();
  return removeUnreferencedAttachments(orphans.map((orphan) => orphan.id));
}
