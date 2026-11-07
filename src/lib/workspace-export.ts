import { db } from "@/db";
import {
  attachments,
  databaseProperties,
  databaseRecordRelations,
  databaseRecords,
  databases,
  databaseTemplates,
  databaseViews,
  pageLinks,
  pageRevisions,
  pageTags,
  pageTemplates,
  pages,
  tags,
} from "@/db/schema";
import { attachmentUrl } from "@/lib/media";

export type WorkspaceExportAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  url: string;
};

/**
 * The portable workspace document. Attachment bytes are deliberately not
 * embedded: callers either stream the JSON alone or pair it with a copy of the
 * attachments directory.
 */
export type WorkspaceExport = {
  format: "kbs-export";
  version: 1;
  exportedAt: string;
  counts: Record<string, number>;
  pages: unknown[];
  pageRevisions: unknown[];
  tags: unknown[];
  pageTags: unknown[];
  pageLinks: unknown[];
  databases: unknown[];
  databaseProperties: unknown[];
  databaseViews: unknown[];
  databaseRecords: unknown[];
  databaseTemplates: unknown[];
  pageTemplates: unknown[];
  databaseRecordRelations: unknown[];
  attachments: WorkspaceExportAttachment[];
  attachmentsNote: string;
};

export async function buildWorkspaceExport(now = new Date()): Promise<WorkspaceExport> {
  const [
    pageRows,
    revisionRows,
    tagRows,
    pageTagRows,
    linkRows,
    databaseRows,
    propertyRows,
    viewRows,
    recordRows,
    templateRows,
    pageTemplateRows,
    relationRows,
    attachmentRows,
  ] = await Promise.all([
    db.select().from(pages),
    db.select().from(pageRevisions),
    db.select().from(tags),
    db.select().from(pageTags),
    db.select().from(pageLinks),
    db.select().from(databases),
    db.select().from(databaseProperties),
    db.select().from(databaseViews),
    db.select().from(databaseRecords),
    db.select().from(databaseTemplates),
    db.select().from(pageTemplates),
    db.select().from(databaseRecordRelations),
    db.select().from(attachments),
  ]);

  return {
    format: "kbs-export",
    version: 1,
    exportedAt: now.toISOString(),
    counts: {
      pages: pageRows.length,
      trashedPages: pageRows.filter((page) => page.deletedAt !== null).length,
      pageRevisions: revisionRows.length,
      tags: tagRows.length,
      pageTags: pageTagRows.length,
      pageLinks: linkRows.length,
      databases: databaseRows.length,
      databaseProperties: propertyRows.length,
      databaseViews: viewRows.length,
      databaseRecords: recordRows.length,
      databaseTemplates: templateRows.length,
      pageTemplates: pageTemplateRows.length,
      databaseRecordRelations: relationRows.length,
      attachments: attachmentRows.length,
    },
    pages: pageRows,
    pageRevisions: revisionRows,
    tags: tagRows,
    pageTags: pageTagRows,
    pageLinks: linkRows,
    databases: databaseRows,
    databaseProperties: propertyRows,
    databaseViews: viewRows,
    databaseRecords: recordRows,
    databaseTemplates: templateRows,
    pageTemplates: pageTemplateRows,
    databaseRecordRelations: relationRows,
    attachments: attachmentRows.map((row) => ({
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
      createdAt: row.createdAt,
      url: attachmentUrl(row.id),
    })),
    attachmentsNote:
      "Attachment bytes are not embedded in this file. A full backup pairs it with a copy of the attachments directory.",
  };
}
