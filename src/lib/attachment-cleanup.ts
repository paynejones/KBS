import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { attachments, databaseRecords, databaseTemplates, pageRevisions, pages } from "@/db/schema";
import { removeAttachmentFile } from "@/lib/attachment-store";
import { attachmentIdsInText } from "@/lib/media";

export type OrphanedAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: Date;
};

function addIds(target: Set<string>, value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  for (const id of attachmentIdsInText(text)) target.add(id);
}

/**
 * Every attachment id still referenced by page content, page covers, page
 * revisions, database record values, or database record templates.
 *
 * Revisions are included on purpose: deleting a file that only an older
 * revision uses would break restoring that revision.
 */
export async function referencedAttachmentIdSet(): Promise<Set<string>> {
  const [pageRows, revisionRows, recordRows, templateRows] = await Promise.all([
    db
      .select({
        content: pages.content,
        contentJson: pages.contentJson,
        coverImageUrl: pages.coverImageUrl,
      })
      .from(pages),
    db
      .select({ content: pageRevisions.content, contentJson: pageRevisions.contentJson })
      .from(pageRevisions),
    db.select({ values: databaseRecords.values }).from(databaseRecords),
    db.select({ values: databaseTemplates.values }).from(databaseTemplates),
  ]);

  const ids = new Set<string>();
  for (const row of pageRows) {
    addIds(ids, row.content);
    addIds(ids, row.contentJson);
    addIds(ids, row.coverImageUrl);
  }
  for (const row of revisionRows) {
    addIds(ids, row.content);
    addIds(ids, row.contentJson);
  }
  for (const row of recordRows) addIds(ids, row.values);
  for (const row of templateRows) addIds(ids, row.values);
  return ids;
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
