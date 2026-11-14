import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiErrorResponse } from "@/lib/api-log";
import { findOrphanPages, findOrphanRecords } from "@/lib/orphans";

// Raw `execute` rows are not read through the column types, so timestamps
// arrive as Postgres text and are turned back into dates when mapping.
type PageFactsRow = {
  id: string;
  title: string;
  parentId: string | null;
  updatedAt: string;
  isInbox: boolean;
  isRecordPage: boolean;
  childCount: number;
  tagCount: number;
  pageLinkCount: number;
  recordLinkCount: number;
};

type RecordFactsRow = {
  id: string;
  title: string;
  updatedAt: string;
  databaseId: string;
  databaseName: string;
  relationCount: number;
  pageLinkCount: number;
};

/**
 * Counts are computed by the database. This route used to read every page link,
 * tag assignment, page-record link, and record relation row into Node and count
 * them in maps, so a scan cost the size of the whole workspace's connections
 * instead of the size of the report. The same question is answered from the
 * join tables' own indexes, one row per page and per record.
 *
 * "Connected" keeps its meaning: a page says yes when it sits in the tree, is
 * tagged, or is joined to another page or a record in either direction, and a
 * record says yes when a relation or a page link touches it.
 */
const PAGE_FACTS = sql`
  SELECT
    page.id,
    page.title,
    page.parent_id AS "parentId",
    page.updated_at AS "updatedAt",
    page.is_inbox AS "isInbox",
    EXISTS (
      SELECT 1 FROM database_records record_page WHERE record_page.page_id = page.id
    ) AS "isRecordPage",
    (SELECT count(*)::int FROM pages child_page
      WHERE child_page.parent_id = page.id AND child_page.deleted_at IS NULL) AS "childCount",
    (SELECT count(*)::int FROM page_tags page_tag
      WHERE page_tag.page_id = page.id) AS "tagCount",
    (SELECT count(*)::int FROM page_links page_link
      WHERE page_link.source_page_id = page.id OR page_link.target_page_id = page.id) AS "pageLinkCount",
    (SELECT count(*)::int FROM page_record_links record_link
      WHERE record_link.page_id = page.id) AS "recordLinkCount"
  FROM pages page
  WHERE page.deleted_at IS NULL
`;

const RECORD_FACTS = sql`
  SELECT
    record.id,
    record.title,
    record.updated_at AS "updatedAt",
    record.database_id AS "databaseId",
    database_row.name AS "databaseName",
    (SELECT count(*)::int FROM database_record_relations record_relation
      WHERE record_relation.source_record_id = record.id
         OR record_relation.target_record_id = record.id) AS "relationCount",
    (SELECT count(*)::int FROM page_record_links record_link
      WHERE record_link.record_id = record.id) AS "pageLinkCount"
  FROM database_records record
  INNER JOIN databases database_row ON record.database_id = database_row.id
`;

export async function GET(request: Request) {
  try {
    const [pageResult, recordResult] = await Promise.all([
      db.execute<PageFactsRow>(PAGE_FACTS),
      db.execute<RecordFactsRow>(RECORD_FACTS),
    ]);

    const orphanPages = findOrphanPages(
      pageResult.rows
        // Inbox captures are their own queue, and a record's page is the
        // record; neither belongs in a list of unconnected pages.
        .filter((page) => !page.isInbox && !page.isRecordPage)
        .map((page) => ({
          id: page.id,
          title: page.title,
          updatedAt: new Date(page.updatedAt),
          parentId: page.parentId,
          childCount: page.childCount,
          tagCount: page.tagCount,
          pageLinkCount: page.pageLinkCount,
          recordLinkCount: page.recordLinkCount,
        })),
    );

    const orphanRecords = findOrphanRecords(
      recordResult.rows.map((record) => ({
        ...record,
        updatedAt: new Date(record.updatedAt),
      })),
    );

    return NextResponse.json({
      pages: orphanPages,
      records: orphanRecords,
      total: orphanPages.length + orphanRecords.length,
    });
  } catch (error) {
    return apiErrorResponse(request, "Failed to find unconnected items", error, { status: 500, logMessage: "Failed to find unconnected items:" });
  }
}
