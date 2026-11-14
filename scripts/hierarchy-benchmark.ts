import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

/**
 * Measures the two workspace-wide reads the page tree and the page browser
 * used to answer in memory:
 *
 *  1. the subtree walk — every route that trashed, purged, moved, or focused a
 *     page selected the whole `pages` table first, and
 *  2. the page browser's tag join — `/api/pages` joined every page-tag pair in
 *     the workspace and discarded the pairs whose page the filters excluded.
 *
 * It never touches the application database. It creates a temporary database
 * from DATABASE_URL, seeds it with a tree the size of a real workspace, and
 * times the old shape against the new one on the same rows.
 */

const PAGE_COUNT = Number(process.env.HIERARCHY_BENCH_PAGES ?? 20_000);
const FANOUT = 4;
const TAGS_PER_PAGE = 2;
const TAG_COUNT = 40;
const RUNS = 7;
// How many pages a page-browser listing returns before its tags are read.
const PAGE_LIST_SIZE = Number(process.env.HIERARCHY_BENCH_LIST ?? 2_000);

const LEGACY_HIERARCHY_SQL = `SELECT id, parent_id AS "parentId" FROM pages`;

const SUBTREE_SQL = `
WITH RECURSIVE subtree AS (
  SELECT id FROM pages WHERE id = $1
  UNION
  SELECT child.id FROM pages child INNER JOIN subtree parent ON child.parent_id = parent.id
)
SELECT id FROM subtree
`;

const SETTINGS_SQL = `
WITH RECURSIVE subtree AS (
  SELECT id FROM pages WHERE id = $1
  UNION
  SELECT child.id FROM pages child INNER JOIN subtree parent ON child.parent_id = parent.id
)
SELECT id, title, icon, is_favorite, parent_id, content_json, sort_order
FROM pages
WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL
`;

const TAGS_FULL_SQL = `
SELECT pt.page_id, t.id, t.name
FROM page_tags pt
INNER JOIN tags t ON t.id = pt.tag_id
`;

const TAGS_FILTERED_SQL = `
SELECT pt.page_id, t.id, t.name
FROM page_tags pt
INNER JOIN tags t ON t.id = pt.tag_id
WHERE pt.page_id = ANY($1::uuid[])
`;

async function seed(client: Client) {
  const ids = Array.from({ length: PAGE_COUNT }, () => randomUUID());

  for (let start = 0; start < ids.length; start += 1000) {
    const rows = ids.slice(start, start + 1000).map((id, offset) => {
      const index = start + offset;
      // A 4-ary tree: deep enough that a full-table walk costs several passes.
      const parent = index === 0 ? "" : ids[Math.floor((index - 1) / FANOUT)];

      return {
        id,
        parent,
        title: `Page ${index}`,
        content: `Body of page ${index} `.repeat(20),
        sortOrder: String(index),
      };
    });

    await client.query(
      `INSERT INTO pages (id, parent_id, title, content, content_json, sort_order)
       SELECT t.id::uuid, nullif(t.parent_id, '')::uuid, t.title, t.content, '{}'::jsonb, t.sort_order::int
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
         AS t(id, parent_id, title, content, sort_order)`,
      [
        rows.map((row) => row.id),
        rows.map((row) => row.parent),
        rows.map((row) => row.title),
        rows.map((row) => row.content),
        rows.map((row) => row.sortOrder),
      ],
    );
  }

  const tagIds = Array.from({ length: TAG_COUNT }, () => randomUUID());
  await client.query(
    `INSERT INTO tags (id, name)
     SELECT t.id::uuid, t.name FROM unnest($1::text[], $2::text[]) AS t(id, name)`,
    [tagIds, tagIds.map((_, index) => `tag-${index}`)],
  );

  const pairs = ids.flatMap((pageId, index) =>
    Array.from({ length: TAGS_PER_PAGE }, (_, offset) => [
      pageId,
      tagIds[(index + offset * 7) % TAG_COUNT],
    ]),
  );

  for (let start = 0; start < pairs.length; start += 2000) {
    const chunk = pairs.slice(start, start + 2000);
    await client.query(
      `INSERT INTO page_tags (page_id, tag_id)
       SELECT t.page_id::uuid, t.tag_id::uuid FROM unnest($1::text[], $2::text[]) AS t(page_id, tag_id)
       ON CONFLICT DO NOTHING`,
      [chunk.map((pair) => pair[0]), chunk.map((pair) => pair[1])],
    );
  }

  return ids;
}

type Measurement = { label: string; ms: number; rows: number; kb: number };

async function measure(
  client: Client,
  label: string,
  sqlText: string,
  params: unknown[] = [],
): Promise<Measurement> {
  const samples: number[] = [];
  let rows = 0;
  let kb = 0;

  for (let run = 0; run < RUNS; run += 1) {
    const startedAt = performance.now();
    const result = await client.query(sqlText, params);
    samples.push(performance.now() - startedAt);

    rows = result.rowCount ?? 0;
    kb = Math.round(Buffer.byteLength(JSON.stringify(result.rows)) / 1024);
  }

  samples.sort((left, right) => left - right);

  return { label, ms: samples[Math.floor(samples.length / 2)], rows, kb };
}

function report(measurements: Measurement[], listIds: string[]) {
  const width = Math.max(...measurements.map((item) => item.label.length));
  console.log(`\n${PAGE_COUNT.toLocaleString()} pages, ${TAGS_PER_PAGE} tags per page, median of ${RUNS}\n`);

  for (const item of measurements) {
    const kb = item.kb > 0 ? `${item.kb.toLocaleString()} KB` : "—";
    console.log(
      `${item.label.padEnd(width)}  ${item.ms.toFixed(1).padStart(8)} ms  ${String(item.rows).padStart(8)} rows  ${kb.padStart(9)}`,
    );
  }

  console.log(`\nTag filter used ${listIds.length.toLocaleString()} page ids.`);
}

async function main() {
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) throw new Error("DATABASE_URL is required to run the hierarchy benchmark.");

  const databaseName = `kbs_hierarchy_bench_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(configuredUrl);
  adminUrl.pathname = "/postgres";
  const benchUrl = new URL(configuredUrl);
  benchUrl.pathname = `/${databaseName}`;
  const admin = new Client({ connectionString: adminUrl.toString() });
  const pool = new Pool({ connectionString: benchUrl.toString(), max: 1 });
  let databaseCreated = false;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    databaseCreated = true;

    const migrationPool = new Pool({ connectionString: benchUrl.toString() });
    try {
      await migrate(drizzle({ client: migrationPool }), {
        migrationsFolder: path.resolve(process.cwd(), "drizzle"),
      });
    } finally {
      await migrationPool.end();
    }

    const client = await pool.connect();
    try {
      const ids = await seed(client);
      await client.query("VACUUM ANALYZE pages");
      await client.query("VACUUM ANALYZE page_tags");
      await client.query("VACUUM ANALYZE tags");

      const rootId = ids[Math.floor(ids.length / 3)] ?? ids[0];
      const listIds = ids.slice(0, PAGE_LIST_SIZE);

      // What separates the shapes is how many rows each one has to move: one
      // per page in the workspace, or one per page in the answer.
      const allPages = await measure(client, "1. legacy: read every page", LEGACY_HIERARCHY_SQL);
      const subtree = await measure(client, "2. current: recursive subtree", SUBTREE_SQL, [rootId]);
      const settings = await measure(client, "3. current: focus settings", SETTINGS_SQL, [
        rootId,
        (await client.query<{ id: string }>(SUBTREE_SQL, [rootId])).rows.map((row) => row.id),
      ]);
      const tagsFull = await measure(client, "4. legacy: join every page-tag pair", TAGS_FULL_SQL);
      const tagsFiltered = await measure(
        client,
        "5. current: join the listed pages only",
        TAGS_FILTERED_SQL,
        [listIds],
      );

      report([allPages, subtree, settings, tagsFull, tagsFiltered], listIds);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();

    if (databaseCreated) {
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [databaseName],
      );
      await admin.query(`DROP DATABASE "${databaseName}"`);
    }

    await admin.end();
  }
}

main().catch((error) => {
  console.error("Hierarchy benchmark failed:", error);
  process.exitCode = 1;
});
