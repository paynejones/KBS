import { NextResponse } from "next/server";
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
  pages,
  tags,
} from "@/db/schema";
import { attachmentUrl } from "@/lib/media";

export async function GET() {
  try {
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
      db.select().from(databaseRecordRelations),
      db.select().from(attachments),
    ]);

    const exportedAt = new Date();
    const payload = {
      format: "kbs-export",
      version: 1,
      exportedAt: exportedAt.toISOString(),
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
        "Attachment bytes are not embedded in this file. Back up the attachments directory (ATTACHMENTS_DIR or data/attachments) with it.",
    };

    const filename = `kbs-export-${exportedAt.toISOString().slice(0, 10)}.json`;

    return NextResponse.json(payload, {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Failed to export workspace:", error);
    return NextResponse.json({ error: "Failed to export the workspace." }, { status: 500 });
  }
}
