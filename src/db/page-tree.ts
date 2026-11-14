import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * The pool-backed client or one of its transactions. Both expose `execute`,
 * which is all a subtree walk needs.
 */
export type QueryExecutor = Pick<typeof db, "execute">;

/**
 * Every page id in `rootId`'s subtree, root included, read with one recursive
 * query over `pages_parent_id_idx`.
 *
 * Routes used to select the whole `pages` table and walk it in memory, which
 * made a move, a purge, or a focus view cost the size of the workspace instead
 * of the size of the subtree. `UNION` (not `UNION ALL`) also makes the walk
 * terminate if a cycle ever reaches the table, where the in-memory version
 * relied on a visited set.
 *
 * An unknown id returns no rows at all, so callers can tell "missing" from
 * "empty subtree" — a page always includes itself.
 */
export async function subtreeIds(executor: QueryExecutor, rootId: string): Promise<string[]> {
  const result = await executor.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM pages WHERE id = ${rootId}
      UNION
      SELECT child.id
      FROM pages child
      INNER JOIN subtree parent ON child.parent_id = parent.id
    )
    SELECT id FROM subtree
  `);

  return result.rows.map((row) => row.id);
}
