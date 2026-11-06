import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

/**
 * Restores a workspace JSON export produced by GET /api/export.
 *
 * Rows are inserted with jsonb_populate_recordset so PostgreSQL performs the
 * tidying of timestamps and jsonb columns. Page parents are inserted as NULL
 * and linked afterwards because the pages table references itself.
 */

const RESTORE_ORDER: { key: string; table: string }[] = [
  { key: "tags", table: "tags" },
  { key: "pages", table: "pages" },
  { key: "pageRevisions", table: "page_revisions" },
  { key: "pageTags", table: "page_tags" },
  { key: "pageLinks", table: "page_links" },
  { key: "databases", table: "databases" },
  { key: "databaseProperties", table: "database_properties" },
  { key: "databaseViews", table: "database_views" },
  { key: "databaseRecords", table: "database_records" },
  { key: "databaseTemplates", table: "database_templates" },
  { key: "pageTemplates", table: "page_templates" },
  { key: "databaseRecordRelations", table: "database_record_relations" },
  { key: "attachments", table: "attachments" },
];

type ExportFile = Record<string, unknown> & {
  format?: unknown;
  version?: unknown;
  attachments?: { id?: unknown }[];
};

function toSnakeCase(key: string) {
  return key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}

function snakeCaseRow(row: unknown) {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return row;
  const converted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    converted[toSnakeCase(key)] = value;
  }
  return converted;
}

async function insertRows(client: Client, table: string, rows: unknown[]) {
  if (rows.length === 0) return 0;
  const result = await client.query(
    `INSERT INTO "${table}"
     SELECT * FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)
     ON CONFLICT DO NOTHING`,
    [JSON.stringify(rows)],
  );
  return result.rowCount ?? 0;
}

function attachmentsDirectory() {
  return process.env.ATTACHMENTS_DIR || path.join(process.cwd(), "data", "attachments");
}

async function missingAttachmentFiles(ids: string[]) {
  if (ids.length === 0) return { missing: 0, checked: 0 };
  let files: string[];
  try {
    files = await readdir(attachmentsDirectory());
  } catch {
    return { missing: ids.length, checked: 0 };
  }
  const present = new Set(files);
  return { missing: ids.filter((id) => !present.has(id)).length, checked: ids.length };
}

async function main() {
  const file = process.argv[2];
  const force = process.argv.includes("--force");

  if (!file) {
    throw new Error("Usage: npm run restore:export -- <path-to-export.json> [--force]");
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to restore a workspace export.");
  }

  const payload = JSON.parse(
    await readFile(path.resolve(file), "utf8"),
  ) as ExportFile;

  if (payload.format !== "kbs-export" || payload.version !== 1) {
    throw new Error("This file is not a version 1 KBS workspace export.");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const existing = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pages",
    );
    if (Number(existing.rows[0]?.count ?? 0) > 0 && !force) {
      throw new Error(
        "The target workspace already contains pages. Restore into an empty database, or re-run with --force to merge.",
      );
    }

    await client.query("BEGIN");
    try {
      for (const { key, table } of RESTORE_ORDER) {
        const raw = payload[key];
        if (!Array.isArray(raw)) continue;
        const rows = raw.map((row) => {
          const converted = snakeCaseRow(row);
          if (table === "pages" && typeof converted === "object" && converted !== null) {
            return { ...(converted as Record<string, unknown>), parent_id: null };
          }
          return converted;
        });
        const inserted = await insertRows(client, table, rows);
        console.log(`${table}: imported ${inserted} of ${rows.length} row(s)`);
      }

      // Link page parents now that every page row exists.
      const pages = payload.pages;
      if (Array.isArray(pages)) {
        await client.query(
          `UPDATE pages AS target
           SET parent_id = source.parent_id
           FROM (
             SELECT id, parent_id
             FROM jsonb_populate_recordset(NULL::pages, $1::jsonb)
             WHERE parent_id IS NOT NULL
           ) AS source
           WHERE target.id = source.id AND target.parent_id IS NULL`,
          [JSON.stringify(pages.map((row) => snakeCaseRow(row)))],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const manifestIds = (payload.attachments ?? [])
      .map((attachment) => attachment?.id)
      .filter((id): id is string => typeof id === "string");
    const files = await missingAttachmentFiles(manifestIds);

    console.log(`Restored ${manifestIds.length} attachment record(s).`);
    if (files.missing > 0) {
      console.warn(
        `Warning: ${files.missing} of ${files.checked} attachment file(s) are missing from ${attachmentsDirectory()}. Copy the attachments directory from the backup before using media on those pages.`,
      );
    }
    console.log("Workspace restore finished.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Workspace restore failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
