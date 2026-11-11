import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

/**
 * Measures what the trigram indexes in migration 0023 buy the two substring
 * searches the app runs: global search (`/api/search`) and the page browser
 * (`/api/pages?q=`).
 *
 * It never touches the application database. It creates a temporary database
 * from DATABASE_URL, seeds it with a workspace large enough for a sequential
 * scan to hurt, times each query with the indexes dropped, builds them, and
 * times the same queries again on the same rows.
 */

const PAGE_COUNT = Number(process.env.SEARCH_BENCH_PAGES ?? 20_000);
const DATABASE_COUNT = 20;
const RECORDS_PER_DATABASE = 2500;
const RUNS = 7;

const WORDS = `
knowledge project reading timeline garden meeting design recipe travel budget sketch release
chapter studio archive lecture notebook outline review signal harbour lantern orchard cinder
meadow pepper compass voyage grammar pallet quarry raven saddle thistle velvet willow zephyr
anchor bramble copper dahlia ember fathom glacier hollow ivory juniper kettle ladder marble
nectar observatory prairie quiver ribbon saffron tundra umber vessel walnut yarrow zinnia
`.trim().split(/\s+/);

// $1 is the substring pattern, $2 the bare term for similarity, and $3 the
// prefix pattern. The inner window (newest matches, $4) mirrors the ranked
// query `/api/search` runs, and keeps ranking off the whole match set.
const SEARCH_PAGES_SQL = `
SELECT id, title, updated_at
FROM (
  SELECT id, title, updated_at, is_favorite
  FROM pages
  WHERE deleted_at IS NULL
    AND (title ILIKE $1 OR content ILIKE $1)
  ORDER BY updated_at DESC
  LIMIT $4
) recent
ORDER BY (
    (CASE
      WHEN lower(title) = lower($2) THEN 3
      WHEN title ILIKE $3 THEN 2
      WHEN title ILIKE $1 THEN 1
      ELSE 0
    END) * 4
    + similarity(title, $2)
    + 0.9 / (1 + extract(epoch from (now() - updated_at)) / 2592000)
    + CASE WHEN is_favorite THEN 0.9 ELSE 0 END
  ) DESC,
  updated_at DESC
LIMIT 8
`;

const SEARCH_PAGES_COUNT_SQL = `
SELECT count(*)::int AS n
FROM pages
WHERE deleted_at IS NULL
  AND (title ILIKE $1 OR content ILIKE $1)
`;

const PAGE_BROWSER_SQL = `
SELECT id, title
FROM pages
WHERE deleted_at IS NULL
  AND is_inbox = false
  AND NOT EXISTS (
    SELECT id FROM database_records WHERE database_records.page_id = pages.id
  )
  AND (title ILIKE $1 OR content ILIKE $1)
ORDER BY sort_order ASC, title ASC
`;

const SEARCH_RECORDS_SQL = `
SELECT r.id, r.title, d.id AS database_id, d.name AS database_name
FROM database_records r
INNER JOIN databases d ON r.database_id = d.id
WHERE r.title ILIKE $1 OR r.values::text ILIKE $1
ORDER BY (
    (CASE
      WHEN lower(r.title) = lower($2) THEN 3
      WHEN r.title ILIKE $3 THEN 2
      WHEN r.title ILIKE $1 THEN 1
      ELSE 0
    END) * 4
    + similarity(r.title, $2)
    + 0.9 / (1 + extract(epoch from (now() - r.updated_at)) / 2592000)
  ) DESC,
  r.updated_at DESC
LIMIT 8
`;

const SEARCH_RECORDS_COUNT_SQL = `
SELECT count(*)::int AS n
FROM database_records
WHERE title ILIKE $1 OR values::text ILIKE $1
`;

// Every matching record, with no ordering or limit: this is the filter cost
// itself, without the ordered index scan that a short result list can hide.
const SEARCH_RECORDS_FILTER_SQL = `
SELECT id, title
FROM database_records
WHERE title ILIKE $1 OR values::text ILIKE $1
`;

// One probe per index, checked with sequential and plain index scans disabled
// so the plan can only come from the trigram index. This proves the index is
// usable for the exact expression each route writes, including the jsonb cast.
const INDEX_PROBES = [
  {
    index: "pages_title_trgm_idx",
    parameter: "%Page 1%",
    sql: "SELECT id FROM pages WHERE title ILIKE $1 LIMIT 1",
  },
  {
    index: "pages_content_trgm_idx",
    parameter: "%quetzalcoatl%",
    sql: "SELECT id FROM pages WHERE content ILIKE $1 LIMIT 1",
  },
  {
    index: "database_records_title_trgm_idx",
    parameter: "%Record 0 10%",
    sql: "SELECT id FROM database_records WHERE title ILIKE $1 LIMIT 1",
  },
  {
    index: "database_records_values_trgm_idx",
    parameter: "%quetzalcoatl%",
    sql: "SELECT id FROM database_records WHERE values::text ILIKE $1 LIMIT 1",
  },
];

type PlanNode = {
  "Node Type": string;
  "Index Name"?: string;
  "Relation Name"?: string;
  Plans?: PlanNode[];
};

type Measurement = {
  medianMs: number;
  plan: string;
};

type Benchmark = {
  name: string;
  term: string;
  sql: string;
  countSql: string;
  /** The query also takes the bare term and a prefix pattern, like the route. */
  ranked?: boolean;
  /** How many newest matches the ranked query ranks. */
  window?: number;
};

type IndexDefinition = {
  name: string;
  definition: string;
};

function pageContent(index: number): string {
  const paragraphs: string[] = [];

  for (let paragraph = 0; paragraph < 12; paragraph += 1) {
    const words: string[] = [];

    for (let word = 0; word < 34; word += 1) {
      words.push(WORDS[(index * 31 + paragraph * 17 + word * 7) % WORDS.length]);
    }

    paragraphs.push(`Paragraph ${paragraph + 1}: ${words.join(" ")}.`);
  }

  // 2% of pages carry a mid-frequency term and 0.06% a rare one, so the
  // benchmark covers selective and unselective lookups.
  if (index % 50 === 0) paragraphs.push("Reference lighthouse for the review.");
  if (index % 1600 === 0) paragraphs.push("Field note: quetzalcoatl sighting.");

  return paragraphs.join("\n");
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }

  return chunks;
}

async function seedPages(client: Client) {
  for (let start = 0; start < PAGE_COUNT; start += 1000) {
    const titles: string[] = [];
    const contents: string[] = [];
    const sortOrders: string[] = [];
    const stamps: string[] = [];

    for (let index = start; index < Math.min(start + 1000, PAGE_COUNT); index += 1) {
      titles.push(`Page ${index} ${WORDS[index % WORDS.length]}`);
      contents.push(pageContent(index));
      sortOrders.push(String(index));
      stamps.push(new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString());
    }

    await client.query(
      `INSERT INTO pages (title, content, content_json, sort_order, created_at, updated_at)
       SELECT t.title, t.content, '{}'::jsonb, t.sort_order::int, t.created_at::timestamptz,
              t.created_at::timestamptz
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
         AS t(title, content, sort_order, created_at)`,
      [titles, contents, sortOrders, stamps],
    );
  }
}

type PropertyIds = { notes: string; status: string; count: string };

async function seedRecords(client: Client) {
  const databases: { id: string; properties: PropertyIds }[] = [];

  for (let index = 0; index < DATABASE_COUNT; index += 1) {
    const databaseId = randomUUID();
    const properties: PropertyIds = {
      notes: randomUUID(),
      status: randomUUID(),
      count: randomUUID(),
    };

    await client.query(
      `INSERT INTO databases (id, name, description) VALUES ($1, $2, '')`,
      [databaseId, `Benchmark database ${index}`],
    );

    for (const [id, name, type] of [
      [properties.notes, "Notes", "text"],
      [properties.status, "Status", "select"],
      [properties.count, "Count", "number"],
    ]) {
      await client.query(
        `INSERT INTO database_properties (id, database_id, name, type, options)
         VALUES ($1, $2, $3, $4, '{}'::jsonb)`,
        [id, databaseId, name, type],
      );
    }

    databases.push({ id: databaseId, properties });
  }

  const rows: {
    databaseId: string;
    title: string;
    values: string;
    sortOrder: number;
    stamp: string;
  }[] = [];

  databases.forEach((database, databaseIndex) => {
    for (let record = 0; record < RECORDS_PER_DATABASE; record += 1) {
      const words = WORDS.slice(record % 10, (record % 10) + 8).join(" ");
      const note = record % 100 === 0
        ? `${words} quetzalcoatl`
        : `${words} notes for record ${record}`;

      rows.push({
        databaseId: database.id,
        title: `Record ${databaseIndex} ${record} ${WORDS[(databaseIndex + record) % WORDS.length]}`,
        values: JSON.stringify({
          [database.properties.notes]: note,
          [database.properties.status]: ["Todo", "Doing", "Done"][record % 3],
          [database.properties.count]: record,
        }),
        sortOrder: record,
        stamp: new Date(Date.UTC(2026, 1, 1) + record * 60_000).toISOString(),
      });
    }
  });

  for (const batch of chunk(rows, 500)) {
    await client.query(
      `INSERT INTO database_records (database_id, title, values, sort_order, created_at, updated_at)
       SELECT t.database_id::uuid, t.title, t.values::jsonb, t.sort_order::int,
              t.created_at::timestamptz, t.created_at::timestamptz
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
         AS t(database_id, title, values, sort_order, created_at)`,
      [
        batch.map((row) => row.databaseId),
        batch.map((row) => row.title),
        batch.map((row) => row.values),
        batch.map((row) => String(row.sortOrder)),
        batch.map((row) => row.stamp),
      ],
    );
  }
}

async function readIndexDefinitions(client: Client): Promise<IndexDefinition[]> {
  const result = await client.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = 'public' AND indexname LIKE '%\\_trgm\\_idx'
     ORDER BY indexname`,
  );

  if (result.rows.length === 0) {
    throw new Error(
      "No trigram indexes found. Apply the project migrations to the temporary database first.",
    );
  }

  return result.rows.map((row) => ({ name: row.indexname, definition: row.indexdef }));
}

function scanSummary(root: PlanNode): string {
  const parts = new Set<string>();

  const visit = (node: PlanNode) => {
    if (node["Node Type"].includes("Scan")) {
      if (node["Index Name"]) parts.add(`${node["Node Type"]} on ${node["Index Name"]}`);
      else if (node["Relation Name"]) parts.add(`${node["Node Type"]} on ${node["Relation Name"]}`);
      else parts.add(node["Node Type"]);
    }

    node.Plans?.forEach(visit);
  };

  visit(root);

  return parts.size > 0 ? [...parts].join(", ") : root["Node Type"];
}

async function measure(client: Client, sqlText: string, parameters: string[]): Promise<Measurement> {
  const times: number[] = [];
  let plan = "";

  // One warm-up execution, then the timed runs.
  for (let run = 0; run <= RUNS; run += 1) {
    const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sqlText}`, parameters);
    const [explained] = result.rows[0]["QUERY PLAN"];

    if (run > 0) times.push(Number(explained["Execution Time"]));
    plan = scanSummary(explained.Plan);
  }

  times.sort((left, right) => left - right);

  return { medianMs: times[Math.floor(times.length / 2)], plan };
}

async function countRows(client: Client, countSql: string, parameters: string[]): Promise<number> {
  const result = await client.query<{ n: number }>(countSql, parameters);

  return Number(result.rows[0]?.n ?? 0);
}

function benchmarks(): Benchmark[] {
  return [
    {
      name: "search pages: rare term",
      term: "quetzalcoatl",
      sql: SEARCH_PAGES_SQL,
      countSql: SEARCH_PAGES_COUNT_SQL,
      ranked: true,
      window: 32,
    },
    {
      name: "search pages: mid term",
      term: "lighthouse",
      sql: SEARCH_PAGES_SQL,
      countSql: SEARCH_PAGES_COUNT_SQL,
      ranked: true,
      window: 32,
    },
    {
      name: "search pages: common term",
      term: "project",
      sql: SEARCH_PAGES_SQL,
      countSql: SEARCH_PAGES_COUNT_SQL,
      ranked: true,
      window: 32,
    },
    {
      name: "page browser: mid term",
      term: "lighthouse",
      sql: PAGE_BROWSER_SQL,
      countSql: SEARCH_PAGES_COUNT_SQL,
    },
    {
      name: "search records: rare term",
      term: "quetzalcoatl",
      sql: SEARCH_RECORDS_SQL,
      countSql: SEARCH_RECORDS_COUNT_SQL,
      ranked: true,
    },
    {
      name: "records: rare term, all rows",
      term: "quetzalcoatl",
      sql: SEARCH_RECORDS_FILTER_SQL,
      countSql: SEARCH_RECORDS_COUNT_SQL,
    },
  ];
}

async function runBenchmarks(client: Client) {
  const results = new Map<string, { rows: number; measurement: Measurement }>();

  for (const benchmark of benchmarks()) {
    const pattern = `%${benchmark.term}%`;
    const parameters = benchmark.ranked
      ? benchmark.window === undefined
        ? [pattern, benchmark.term, `${benchmark.term}%`]
        : [pattern, benchmark.term, `${benchmark.term}%`, String(benchmark.window)]
      : [pattern];
    results.set(benchmark.name, {
      rows: await countRows(client, benchmark.countSql, [pattern]),
      measurement: await measure(client, benchmark.sql, parameters),
    });
  }

  return results;
}

async function verifyIndexes(client: Client) {
  const results: { index: string; usable: boolean; plan: string }[] = [];

  await client.query("SET enable_seqscan = off");
  await client.query("SET enable_indexscan = off");
  try {
    for (const probe of INDEX_PROBES) {
      const result = await client.query(
        `EXPLAIN (COSTS OFF, FORMAT JSON) ${probe.sql}`,
        [probe.parameter],
      );
      const plan = scanSummary(result.rows[0]["QUERY PLAN"][0].Plan);

      results.push({ index: probe.index, usable: plan.includes(probe.index), plan });
    }
  } finally {
    await client.query("SET enable_indexscan = on");
    await client.query("SET enable_seqscan = on");
  }

  return results;
}

async function buildIndexes(client: Client, definitions: IndexDefinition[]) {
  const startedAt = performance.now();

  for (const definition of definitions) {
    await client.query(definition.definition);
  }

  return performance.now() - startedAt;
}

async function readIndexSizes(client: Client, names: string[]) {
  const result = await client.query<{ name: string; bytes: string }>(
    `SELECT c.relname AS name, pg_relation_size(c.oid)::text AS bytes
     FROM pg_class c
     WHERE c.relname = ANY($1::text[])`,
    [names],
  );

  return result.rows.map((row) => ({ name: row.name, bytes: Number(row.bytes) }));
}

function formatMs(value: number) {
  return `${value.toFixed(1)} ms`;
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;

  return `${value} bytes`;
}

function report({
  before,
  after,
  buildMs,
  sizes,
  probes,
}: {
  before: Awaited<ReturnType<typeof runBenchmarks>>;
  after: Awaited<ReturnType<typeof runBenchmarks>>;
  buildMs: number;
  sizes: { name: string; bytes: number }[];
  probes: Awaited<ReturnType<typeof verifyIndexes>>;
}) {
  const nameWidth = 28;
  const rowWidth = 10;

  console.log(
    `\nSearch benchmark — ${PAGE_COUNT.toLocaleString()} pages, ` +
      `${(DATABASE_COUNT * RECORDS_PER_DATABASE).toLocaleString()} records`,
  );
  console.log(`(median of ${RUNS} runs on a temporary database, dropped afterwards)\n`);

  console.log(
    "query".padEnd(nameWidth) +
      "rows".padStart(rowWidth) +
      "before".padStart(rowWidth + 2) +
      "after".padStart(rowWidth + 2) +
      "speedup".padStart(rowWidth),
  );
  console.log("-".repeat(nameWidth + rowWidth * 4 + 4));

  for (const [name, beforeResult] of before) {
    const afterResult = after.get(name);
    if (!afterResult) continue;

    const speedup = afterResult.measurement.medianMs > 0
      ? `${(beforeResult.measurement.medianMs / afterResult.measurement.medianMs).toFixed(0)}x`
      : "—";

    console.log(
      name.padEnd(nameWidth) +
        String(beforeResult.rows).padStart(rowWidth) +
        formatMs(beforeResult.measurement.medianMs).padStart(rowWidth + 2) +
        formatMs(afterResult.measurement.medianMs).padStart(rowWidth + 2) +
        speedup.padStart(rowWidth),
    );
    console.log(`  before plan: ${beforeResult.measurement.plan}`);
    console.log(`  after plan:  ${afterResult.measurement.plan}`);
  }

  const unusable = probes.filter((probe) => !probe.usable);
  const usableText = probes.length - unusable.length;
  console.log(
    `\nindex usable for its query: ${usableText}/${probes.length}` +
      (unusable.length > 0
        ? ` — ${unusable.map((probe) => `${probe.index} (${probe.plan})`).join("; ")}`
        : " (checked with sequential and plain index scans disabled)"),
  );

  console.log(`index build time: ${formatMs(buildMs)}`);
  const totalBytes = sizes.reduce((total, size) => total + size.bytes, 0);
  console.log(`index size: ${formatBytes(totalBytes)} across ${sizes.length} indexes`);

  console.log(
    "\nTerms of three characters or more carry trigrams the index can answer. Ranking only the\n" +
      "newest 32 matches keeps a broad term cheap: the window fills from the updated_at index\n" +
      "instead of reading every page that mentions it.",
  );
}

async function waitForDatabaseConnectionsToClose(admin: Client, databaseName: string) {
  const timeoutAt = Date.now() + 10_000;

  while (Date.now() < timeoutAt) {
    const result = await admin.query<{ connections: string }>(
      "SELECT count(*)::text AS connections FROM pg_stat_activity WHERE datname = $1",
      [databaseName],
    );

    if (Number(result.rows[0]?.connections ?? 0) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for connections to temporary database ${databaseName} to close.`);
}

async function main() {
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) throw new Error("DATABASE_URL is required to run the search benchmark.");

  const databaseName = `kbs_search_bench_${process.pid}_${Date.now()}`;
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
      // Measure the current queries without the indexes, then with them, on
      // the same rows in the same database.
      const definitions = await readIndexDefinitions(client);
      for (const definition of definitions) {
        await client.query(`DROP INDEX "${definition.name}"`);
      }

      await seedPages(client);
      await seedRecords(client);
      await client.query("VACUUM ANALYZE pages");
      await client.query("VACUUM ANALYZE database_records");

      const before = await runBenchmarks(client);
      const buildMs = await buildIndexes(client, definitions);
      await client.query("VACUUM ANALYZE pages");
      await client.query("VACUUM ANALYZE database_records");
      const after = await runBenchmarks(client);
      const sizes = await readIndexSizes(client, definitions.map((definition) => definition.name));
      const probes = await verifyIndexes(client);

      report({ before, after, buildMs, sizes, probes });
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
      await waitForDatabaseConnectionsToClose(admin, databaseName);
      await admin.query(`DROP DATABASE "${databaseName}"`);
    }

    await admin.end();
  }
}

main().catch((error) => {
  console.error("Search benchmark failed:", error);
  process.exitCode = 1;
});
