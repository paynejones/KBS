import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { apiErrorResponse } from "@/lib/api-log";

type TrashItem = {
  id: string;
  title: string;
  deletedAt: Date | null;
  isInbox: boolean;
  updatedAt: Date;
  descendantCount: number;
};

// Raw `execute` rows are not read through the column types, so timestamps
// arrive as Postgres text and are turned back into dates when mapping.
type TrashRow = {
  id: string;
  title: string;
  deletedAt: string | null;
  isInbox: boolean;
  updatedAt: string;
  descendantCount: number;
};

/**
 * Each row is one removed subtree: a trashed page whose parent is not trashed,
 * with the number of trashed pages beneath it.
 *
 * The route used to select every trashed row twice and then walk the whole
 * hierarchy once per root to size it, which cost roots × pages in Node. The
 * walk belongs in the database, where one recursive query over
 * `pages_parent_id_idx` visits each trashed page once. Only trashed children
 * count, matching the trash list: a page can only be restored with the branch
 * that was removed with it.
 */
export async function GET(request: Request) {
  try {
    const [roots, total] = await Promise.all([
      db.execute<TrashRow>(sql`
        WITH RECURSIVE trashed AS (
          SELECT id, parent_id FROM pages WHERE deleted_at IS NOT NULL
        ),
        roots AS (
          SELECT page.id, page.title, page.deleted_at, page.is_inbox, page.updated_at
          FROM pages page
          WHERE page.deleted_at IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM trashed parent WHERE parent.id = page.parent_id
            )
        ),
        walk AS (
          SELECT roots.id AS root_id, roots.id AS page_id FROM roots
          UNION
          SELECT walk.root_id, child.id
          FROM walk
          INNER JOIN pages child ON child.parent_id = walk.page_id
          WHERE child.deleted_at IS NOT NULL
        )
        SELECT
          roots.id,
          roots.title,
          roots.deleted_at AS "deletedAt",
          roots.is_inbox AS "isInbox",
          roots.updated_at AS "updatedAt",
          (count(walk.page_id)::int - 1) AS "descendantCount"
        FROM roots
        INNER JOIN walk ON walk.root_id = roots.id
        GROUP BY roots.id, roots.title, roots.deleted_at, roots.is_inbox, roots.updated_at
        ORDER BY roots.deleted_at DESC
      `),
      // The header counts everything in the trash, including a trashed page
      // whose parent is gone, so it stays a plain count.
      db.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM pages WHERE deleted_at IS NOT NULL`,
      ),
    ]);

    const items: TrashItem[] = roots.rows.map((row) => ({
      id: row.id,
      title: row.title,
      deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
      isInbox: row.isInbox,
      updatedAt: new Date(row.updatedAt),
      descendantCount: row.descendantCount ?? 0,
    }));

    return NextResponse.json({ items, totalTrashed: total.rows[0]?.total ?? 0 });
  } catch (error) {
    return apiErrorResponse(request, "Failed to load trash.", error, { status: 500, logMessage: "Failed to load trash:" });
  }
}
