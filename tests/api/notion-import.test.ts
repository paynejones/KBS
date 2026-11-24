import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { createTestDatabase, type TestDatabase } from "./db-harness";

/**
 * Drives the real importer (`scripts/import-notion.ts`) against a temporary
 * database and a fake Notion API. Only the HTTP boundary is faked, so these
 * tests cover the conversion passes, the SQL the importer writes, and the CLI
 * flags together, the way a real run exercises them.
 */

type Json = Record<string, unknown>;

// -- Fixture ids -------------------------------------------------------------

const ID = {
  journal: "10000000-0000-4000-8000-000000000001",
  alpha: "10000000-0000-4000-8000-000000000002",
  beta: "10000000-0000-4000-8000-000000000003",
  gamma: "10000000-0000-4000-8000-000000000004",
  delta: "10000000-0000-4000-8000-000000000005",
  projectsDatabase: "20000000-0000-4000-8000-000000000010",
  projectsSource: "20000000-0000-4000-8000-000000000011",
  tasksDatabase: "30000000-0000-4000-8000-000000000020",
  tasksSource: "30000000-0000-4000-8000-000000000021",
  projectAlpha: "40000000-0000-4000-8000-000000000030",
  projectBeta: "40000000-0000-4000-8000-000000000031",
  taskOne: "50000000-0000-4000-8000-000000000040",
  taskTwo: "50000000-0000-4000-8000-000000000041",
};

/** Notion's timestamps for the first import, a later edit, and a local edit. */
const IMPORTED_AT = "2026-01-01T00:00:00.000Z";
const NOTION_EDITED_AT = "2026-02-01T00:00:00.000Z";
const KBS_EDITED_AT = "2026-03-01T00:00:00.000Z";

const IMAGE_NAME = "photo.png";
/** A file the fake server refuses until a retry test turns it on. */
const LATE_IMAGE = "late.png";
const IMAGE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// -- Fake Notion workspace ---------------------------------------------------

type BodyItem =
  | { text: string; href?: string }
  | { image: string }
  | { video: string; caption: string }
  | { videoUpload: string; caption: string }
  | { childPage: string; title: string };

type FakePage = {
  id: string;
  title: string;
  parentId: string | null;
  body: BodyItem[];
  editedAt: string;
  trashed?: boolean;
};

type FakeRecord = {
  id: string;
  title: string;
  editedAt: string;
  properties: Json;
  trashed?: boolean;
};

type FakeDatabase = {
  id: string;
  dataSourceId: string;
  title: string;
  editedAt: string;
  properties: Json;
  records: FakeRecord[];
  trashed?: boolean;
};

type FakeWorkspace = {
  pages: Map<string, FakePage>;
  databases: Map<string, FakeDatabase>;
};

function richText(text: string) {
  return [{ type: "text", text: { content: text }, plain_text: text }];
}

/** The page URL Notion puts behind an inline link to another page. */
function notionPageUrl(id: string) {
  return `https://www.notion.so/${id.replace(/-/g, "")}`;
}

function numberValue(id: string, number: number) {
  return { id, type: "number", number };
}

function formulaValue(id: string, formula: Json) {
  return { id, type: "formula", formula };
}

function rollupValue(id: string, rollup: Json) {
  return { id, type: "rollup", rollup };
}

/**
 * Two databases whose properties cover every mapping the importer documents:
 * a relation KBS can recreate, rollups it can compute (count, sum) and rollups
 * it cannot (median, show_unique), plus formulas it can translate (arithmetic
 * over a number property) and formulas it cannot (mod, concat).
 */
function createWorkspace(): FakeWorkspace {
  const projectProperties: Json = {
    Name: { id: "title", name: "Name", type: "title", title: {} },
    Estimate: { id: "est", name: "Estimate", type: "number", number: { format: "number" } },
    Phase: {
      id: "phase",
      name: "Phase",
      type: "status",
      status: {
        options: [
          { id: "phase-backlog", name: "Backlog" },
          { id: "phase-doing", name: "Doing" },
          { id: "phase-done", name: "Done" },
        ],
        groups: [],
      },
    },
    Tasks: {
      id: "tasks",
      name: "Tasks",
      type: "relation",
      relation: { data_source_id: ID.tasksSource, database_id: ID.tasksDatabase },
    },
    "Task count": {
      id: "rollup-count",
      name: "Task count",
      type: "rollup",
      rollup: { relation_property_id: "tasks", rollup_property_id: "title", function: "count" },
    },
    "Total effort": {
      id: "rollup-sum",
      name: "Total effort",
      type: "rollup",
      rollup: { relation_property_id: "tasks", rollup_property_id: "effort", function: "sum" },
    },
    "Median effort": {
      id: "rollup-median",
      name: "Median effort",
      type: "rollup",
      rollup: { relation_property_id: "tasks", rollup_property_id: "effort", function: "median" },
    },
    Owners: {
      id: "rollup-owners",
      name: "Owners",
      type: "rollup",
      rollup: {
        relation_property_id: "tasks",
        rollup_property_id: "title",
        function: "show_unique",
      },
    },
    Score: {
      id: "formula-score",
      name: "Score",
      type: "formula",
      formula: { expression: 'prop("Estimate") * 2' },
    },
    Remainder: {
      id: "formula-remainder",
      name: "Remainder",
      type: "formula",
      formula: { expression: 'mod(prop("Estimate"), 2)' },
    },
    Label: {
      id: "formula-label",
      name: "Label",
      type: "formula",
      formula: { expression: 'concat(prop("Name"), "!")' },
    },
  };

  const taskProperties: Json = {
    Name: { id: "title", name: "Name", type: "title", title: {} },
    Effort: { id: "effort", name: "Effort", type: "number", number: { format: "number" } },
  };

  const pages = new Map<string, FakePage>([
    [
      ID.journal,
      {
        id: ID.journal,
        title: "Journal",
        parentId: null,
        editedAt: IMPORTED_AT,
        body: [
          { text: "intro" },
          // Notion-hosted video: kept as an expiring link, never downloaded.
          { video: "clip.mp4", caption: "launch clip" },
          // A newer file upload has no inline URL; it resolves via /file_uploads.
          { videoUpload: "upload-clip-2", caption: "second clip" },
          { image: IMAGE_NAME },
          { image: LATE_IMAGE },
          { childPage: ID.alpha, title: "Alpha" },
          { childPage: ID.beta, title: "Beta" },
          { childPage: ID.gamma, title: "Gamma" },
        ],
      },
    ],
    [
      ID.alpha,
      { id: ID.alpha, title: "Alpha", parentId: ID.journal, editedAt: IMPORTED_AT, body: [{ text: "alpha one" }] },
    ],
    [
      ID.beta,
      { id: ID.beta, title: "Beta", parentId: ID.journal, editedAt: IMPORTED_AT, body: [{ text: "beta one" }] },
    ],
    [
      ID.gamma,
      { id: ID.gamma, title: "Gamma", parentId: ID.journal, editedAt: IMPORTED_AT, body: [{ text: "gamma one" }] },
    ],
  ]);

  const databases = new Map<string, FakeDatabase>([
    [
      ID.projectsDatabase,
      {
        id: ID.projectsDatabase,
        dataSourceId: ID.projectsSource,
        title: "Projects",
        editedAt: IMPORTED_AT,
        properties: projectProperties,
        records: [
          {
            id: ID.projectAlpha,
            title: "Alpha",
            editedAt: IMPORTED_AT,
            properties: {
              Estimate: numberValue("est", 4),
              Phase: { id: "phase", type: "status", status: { name: "Doing" } },
              Tasks: {
                id: "tasks",
                type: "relation",
                relation: [{ id: ID.taskOne }, { id: ID.taskTwo }],
              },
              "Task count": rollupValue("rollup-count", { type: "number", number: 2, function: "count" }),
              "Total effort": rollupValue("rollup-sum", { type: "number", number: 6, function: "sum" }),
              "Median effort": rollupValue("rollup-median", { type: "number", number: 3, function: "median" }),
              Owners: rollupValue("rollup-owners", {
                type: "array",
                function: "show_unique",
                array: [
                  { type: "title", title: richText("Task one") },
                  { type: "title", title: richText("Task two") },
                ],
              }),
              Score: formulaValue("formula-score", { type: "number", number: 8 }),
              Remainder: formulaValue("formula-remainder", { type: "number", number: 0 }),
              Label: formulaValue("formula-label", { type: "string", string: "Alpha!" }),
            },
          },
          {
            id: ID.projectBeta,
            title: "Beta",
            editedAt: IMPORTED_AT,
            properties: {},
          },
        ],
      },
    ],
    [
      ID.tasksDatabase,
      {
        id: ID.tasksDatabase,
        dataSourceId: ID.tasksSource,
        title: "Tasks",
        editedAt: IMPORTED_AT,
        properties: taskProperties,
        records: [
          {
            id: ID.taskOne,
            title: "Task one",
            editedAt: IMPORTED_AT,
            properties: { Effort: numberValue("effort", 2) },
          },
          {
            id: ID.taskTwo,
            title: "Task two",
            editedAt: IMPORTED_AT,
            properties: { Effort: numberValue("effort", 4) },
          },
        ],
      },
    ],
  ]);

  return { pages, databases };
}

// -- Fake Notion HTTP API ----------------------------------------------------

type FakeServer = {
  server: Server;
  baseUrl: string;
  serveLateImage: (available: boolean) => void;
};

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body);
}

function pagePayload(page: FakePage): Json {
  return {
    object: "page",
    id: page.id,
    created_time: IMPORTED_AT,
    last_edited_time: page.editedAt,
    in_trash: page.trashed ?? false,
    archived: false,
    icon: null,
    cover: null,
    parent: page.parentId
      ? { type: "page_id", page_id: page.parentId }
      : { type: "workspace", workspace: true },
    properties: { title: { id: "title", type: "title", title: richText(page.title) } },
  };
}

function blocksPayload(page: FakePage, baseUrl: string): Json[] {
  return page.body.map((item, index) => {
    const id = `${page.id}-block-${index}`;
    if ("text" in item) {
      return {
        object: "block",
        id,
        type: "paragraph",
        has_children: false,
        paragraph: {
          rich_text: [{
            type: "text",
            text: {
              content: item.text,
              link: item.href ? { url: item.href } : null,
            },
            plain_text: item.text,
          }],
        },
      };
    }
    if ("image" in item) {
      return {
        object: "block",
        id,
        type: "image",
        has_children: false,
        image: {
          type: "file",
          file: { url: `${baseUrl}/files/${item.image}`, expiry_time: "2026-12-31T00:00:00.000Z" },
          caption: [],
        },
      };
    }
    if ("video" in item) {
      return {
        object: "block",
        id,
        type: "video",
        has_children: false,
        video: {
          type: "file",
          file: { url: `${baseUrl}/files/${item.video}`, expiry_time: "2026-01-01T01:00:00.000Z" },
          caption: richText(item.caption),
        },
      };
    }
    if ("videoUpload" in item) {
      return {
        object: "block",
        id,
        type: "video",
        has_children: false,
        video: {
          type: "file_upload",
          file_upload: { id: item.videoUpload },
          caption: richText(item.caption),
        },
      };
    }
    // Notion uses the child page's own id as the block id.
    return {
      object: "block",
      id: item.childPage,
      type: "child_page",
      has_children: false,
      child_page: { title: item.title },
    };
  });
}

function recordPayload(database: FakeDatabase, record: FakeRecord): Json {
  return {
    object: "page",
    id: record.id,
    created_time: IMPORTED_AT,
    last_edited_time: record.editedAt,
    in_trash: record.trashed ?? false,
    archived: false,
    parent: { type: "data_source_id", data_source_id: database.dataSourceId },
    properties: {
      Name: { id: "title", type: "title", title: richText(record.title) },
      ...record.properties,
    },
  };
}

async function startFakeNotion(workspace: FakeWorkspace): Promise<FakeServer> {
  let baseUrl = "";
  let lateImageAvailable = false;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] === "files") {
      const filename = parts[1] ?? "";
      if (filename !== IMAGE_NAME && !(filename === LATE_IMAGE && lateImageAvailable)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "content-type": "image/png",
        "content-length": String(IMAGE_BYTES.byteLength),
      });
      response.end(IMAGE_BYTES);
      return;
    }

    if (parts[0] === "pages" && parts.length === 2) {
      const page = workspace.pages.get(parts[1]);
      if (page) {
        sendJson(response, 200, pagePayload(page));
        return;
      }
      // A record is a page in Notion; --prune-trashed asks about it by id.
      for (const database of workspace.databases.values()) {
        const record = database.records.find((row) => row.id === parts[1]);
        if (record) {
          sendJson(response, 200, recordPayload(database, record));
          return;
        }
      }
      sendJson(response, 404, { object: "error", code: "object_not_found", message: "No page" });
      return;
    }

    if (parts[0] === "file_uploads" && parts.length === 2) {
      // A file upload has no inline URL; its signed URL comes from this lookup.
      sendJson(response, 200, {
        object: "file_upload",
        id: parts[1],
        upload_url: `${baseUrl}/files/uploaded-video.mp4`,
      });
      return;
    }

    if (parts[0] === "blocks" && parts[2] === "children") {
      const page = workspace.pages.get(parts[1]);
      // Record pages have no body blocks; an empty list is what Notion returns.
      sendJson(response, 200, {
        object: "list",
        results: page ? blocksPayload(page, baseUrl) : [],
        has_more: false,
        next_cursor: null,
      });
      return;
    }

    if (parts[0] === "databases" && parts.length === 2) {
      const database = [...workspace.databases.values()].find((row) => row.id === parts[1]);
      if (!database) {
        sendJson(response, 404, { object: "error", code: "object_not_found", message: "No database" });
        return;
      }
      sendJson(response, 200, {
        object: "database",
        id: database.id,
        title: richText(database.title),
        icon: null,
        created_time: IMPORTED_AT,
        last_edited_time: database.editedAt,
        in_trash: database.trashed ?? false,
        data_sources: [{ id: database.dataSourceId, name: database.title }],
      });
      return;
    }

    if (parts[0] === "data_sources") {
      const database = [...workspace.databases.values()].find(
        (row) => row.dataSourceId === parts[1],
      );
      if (!database) {
        sendJson(response, 404, { object: "error", code: "object_not_found", message: "No data source" });
        return;
      }
      if (parts[2] === "query") {
        sendJson(response, 200, {
          object: "list",
          results: database.records.map((record) => recordPayload(database, record)),
          has_more: false,
          next_cursor: null,
          request_status: { type: "success" },
        });
        return;
      }
      sendJson(response, 200, {
        object: "data_source",
        id: database.dataSourceId,
        title: richText(database.title),
        created_time: IMPORTED_AT,
        last_edited_time: database.editedAt,
        in_trash: database.trashed ?? false,
        properties: database.properties,
      });
      return;
    }

    sendJson(response, 404, { object: "error", code: "object_not_found", message: "No route" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake Notion server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    server,
    baseUrl,
    serveLateImage: (available: boolean) => {
      lateImageAvailable = available;
    },
  };
}

// -- Importer runner ---------------------------------------------------------

type RunResult = { status: number; output: string };

const TSX_CLI = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

/**
 * Runs the importer exactly as `npm run import:notion` would. The child must be
 * asynchronous: the fake Notion server lives in this process, and a blocking
 * spawn would keep the event loop from answering the importer's requests.
 */
function runImporter(
  args: string[],
  environment: { databaseUrl: string; attachmentsDir: string; apiBase: string },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, "scripts/import-notion.ts", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: environment.databaseUrl,
        ATTACHMENTS_DIR: environment.attachmentsDir,
        NOTION_TOKEN: "test-token",
        NOTION_API_BASE: environment.apiBase,
        // A root list in the developer's .env must not widen these tests.
        NOTION_ROOT_IDS: "",
      },
    });

    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    const timeout = setTimeout(() => child.kill(), 180_000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ status: code ?? -1, output });
    });
  });
}

// -- Tests -------------------------------------------------------------------

describe("Notion importer", () => {
  let harness: TestDatabase;
  let pool: Pool;
  let fake: FakeServer;
  let workspace: FakeWorkspace;
  let manifestPath: string;
  let updateManifestPath: string;
  let retryManifestPath: string;
  let reimportManifestPath: string;
  let pruneManifestPath: string;
  let importRun: RunResult;

  const environment = () => ({
    databaseUrl: harness.url,
    attachmentsDir: harness.attachmentsDir,
    apiBase: fake.baseUrl,
  });

  const run = (args: string[]) => runImporter(args, environment());

  const roots = ["--root", ID.journal, "--root", ID.projectsDatabase, "--root", ID.tasksDatabase];

  async function rows<T = Json>(sql: string, values: unknown[] = []): Promise<T[]> {
    const result = await pool.query(sql, values);
    return result.rows as T[];
  }

  type PropertyRow = { id: string; name: string; type: string; options: Json; database_id: string };
  type RecordRow = { id: string; title: string; values: Json; database_id: string; updated_at: Date };
  type PageRow = { id: string; title: string; content: string; updated_at: Date };

  async function properties(): Promise<Map<string, PropertyRow>> {
    return new Map((await rows<PropertyRow>("SELECT * FROM database_properties")).map((row) => [row.name, row]));
  }

  async function pageByTitle(title: string): Promise<PageRow> {
    const [page] = await rows<PageRow>("SELECT id, title, content, updated_at FROM pages WHERE title = $1", [title]);
    assert.ok(page, `expected a page titled ${title}`);
    return page;
  }

  before(async () => {
    harness = await createTestDatabase();
    pool = new Pool({ connectionString: harness.url });
    workspace = createWorkspace();
    fake = await startFakeNotion(workspace);
    manifestPath = path.join(tmpdir(), `kbs-notion-import-${process.pid}-${Date.now()}.json`);
    reimportManifestPath = path.join(tmpdir(), `kbs-notion-reimport-${process.pid}-${Date.now()}.json`);
    importRun = await run([...roots, "--manifest", manifestPath]);
  });

  after(async () => {
    if (fake) await new Promise<void>((resolve) => fake.server.close(() => resolve()));
    if (manifestPath) await rm(manifestPath, { force: true });
    if (updateManifestPath) await rm(updateManifestPath, { force: true });
    if (retryManifestPath) await rm(retryManifestPath, { force: true });
    if (reimportManifestPath) await rm(reimportManifestPath, { force: true });
    if (pruneManifestPath) await rm(pruneManifestPath, { force: true });
    if (pool) await pool.end();
    if (harness) await harness.dispose();
  });

  it("imports the workspace and records it in a manifest", async () => {
    assert.equal(importRun.status, 0, importRun.output);

    // A Notion-hosted video never reaches the downloader, so the run has to
    // say that the links it keeps will expire and a retry will not fix them.
    // Both the `file` and the `file_upload` shapes count as hosted, and the
    // detail is collapsed into one summary line instead of one per block.
    assert.match(
      importRun.output,
      /2 Notion-hosted video\/audio blocks kept as expiring links \(2 video\); --retry-files cannot refresh them\./,
    );
    assert.doesNotMatch(importRun.output, /Notion-hosted video is kept as a link/);
    const journal = await pageByTitle("Journal");
    assert.match(journal.content, /launch clip/, "the video stays as a link");
    assert.match(journal.content, /second clip/, "a file-upload video is kept too");
    const [journalJson] = await rows<{ content_json: Json }>(
      "SELECT content_json FROM pages WHERE title = 'Journal'",
    );
    assert.match(
      JSON.stringify(journalJson.content_json),
      /\/files\/uploaded-video\.mp4/,
      "a file_upload video resolves through /file_uploads instead of being dropped",
    );

    const [count] = await rows<{ count: number }>("SELECT count(*)::int AS count FROM pages");
    assert.equal(
      count.count,
      10,
      "Journal, its three child pages, two database pages, and four record pages",
    );

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.format, "kbs-import-manifest");
    assert.equal(manifest.rows.pages.length, 10);
    assert.equal(manifest.rows.databaseRecords.length, 4);
    assert.equal(manifest.files.length, 1);

    // The Notion ids are stored so a later --update can ask Notion about an
    // object that no longer appears in the walk. Record pages are represented
    // by their record row.
    const mapped = await rows<{ kind: string; count: number }>(
      "SELECT kind, count(*)::int AS count FROM notion_objects GROUP BY kind ORDER BY kind",
    );
    assert.deepEqual(mapped, [
      { kind: "database", count: 2 },
      { kind: "page", count: 4 },
      { kind: "record", count: 4 },
    ]);
  });

  it("maps rollups and formulas KBS can compute and snapshots the rest", async () => {
    const byName = await properties();
    const databases = new Map(
      (await rows<{ id: string; name: string }>("SELECT id, name FROM databases")).map((row) => [row.name, row.id]),
    );
    const projectsId = databases.get("Projects");
    const tasksId = databases.get("Tasks");
    assert.ok(projectsId && tasksId);

    // Plain property mapping: status becomes a select with its choices.
    assert.equal(byName.get("Estimate")?.type, "number");
    assert.equal(byName.get("Phase")?.type, "select");
    assert.deepEqual(byName.get("Phase")?.options, { choices: ["Backlog", "Doing", "Done"] });
    assert.deepEqual(byName.get("Tasks")?.options, { relatedDatabaseId: tasksId });

    // count needs no target property; sum keeps the relation and the target.
    assert.equal(byName.get("Task count")?.type, "rollup");
    assert.deepEqual(byName.get("Task count")?.options, {
      relatedDatabaseId: tasksId,
      relationPropertyId: byName.get("Tasks")?.id,
      aggregation: "count",
    });
    assert.deepEqual(byName.get("Total effort")?.options, {
      relatedDatabaseId: tasksId,
      relationPropertyId: byName.get("Tasks")?.id,
      targetPropertyId: byName.get("Effort")?.id,
      aggregation: "sum",
    });

    // Functions KBS does not have become number or text snapshots.
    assert.equal(byName.get("Median effort")?.type, "number");
    assert.deepEqual(byName.get("Median effort")?.options, {});
    assert.equal(byName.get("Owners")?.type, "text");

    // Arithmetic translates into KBS formula syntax; the rest snapshots.
    assert.equal(byName.get("Score")?.type, "formula");
    assert.deepEqual(byName.get("Score")?.options, { expression: "({Estimate} * 2)" });
    assert.equal(byName.get("Remainder")?.type, "number");
    assert.equal(byName.get("Label")?.type, "text");

    const projectRecords = (await rows<RecordRow>("SELECT * FROM database_records WHERE database_id = $1", [projectsId]));
    const alpha = projectRecords.find((record) => record.title === "Alpha");
    assert.ok(alpha);
    const values = alpha.values;

    // A computed rollup or formula owns its value; a snapshot keeps Notion's.
    assert.equal(values[byName.get("Task count")!.id], undefined);
    assert.equal(values[byName.get("Total effort")!.id], undefined);
    assert.equal(values[byName.get("Score")!.id], undefined);
    assert.equal(values[byName.get("Median effort")!.id], 3);
    assert.equal(values[byName.get("Owners")!.id], "Task one, Task two");
    assert.equal(values[byName.get("Remainder")!.id], 0);
    assert.equal(values[byName.get("Label")!.id], "Alpha!");

    const relations = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM database_record_relations",
    );
    assert.equal(relations[0].count, 2);

    // The status property also earns the inferred board view.
    const views = await rows<{ type: string; config: Json }>(
      "SELECT type, config FROM database_views WHERE database_id = $1 ORDER BY sort_order",
      [projectsId],
    );
    assert.deepEqual(views.map((view) => view.type), ["table", "board"]);
    assert.deepEqual(views[1].config, { groupBy: byName.get("Phase")?.id });
  });

  it("--update rewrites only rows Notion edited since their stored timestamp", async (t) => {
    // Notion edited Alpha (new title, body and an inline link) after the import.
    const alpha = workspace.pages.get(ID.alpha)!;
    const alphaSnapshot = {
      title: alpha.title,
      body: alpha.body,
      editedAt: alpha.editedAt,
    };
    alpha.title = "Alpha renamed";
    alpha.body = [
      { text: "alpha two" },
      { image: IMAGE_NAME },
      { text: "see Gamma", href: notionPageUrl(ID.gamma) },
    ];
    alpha.editedAt = NOTION_EDITED_AT;

    // Notion also moved Alpha under Beta. Beta itself is not refreshed, which
    // proves the move follows Alpha's own timestamp rather than Beta's.
    const beta = workspace.pages.get(ID.beta)!;
    beta.body = [{ text: "beta two" }, { childPage: ID.alpha, title: "Alpha renamed" }];

    const projects = workspace.databases.get(ID.projectsDatabase)!;
    const projectBeta = projects.records.find((record) => record.id === ID.projectBeta)!;
    const projectsSnapshot = {
      properties: structuredClone(projects.properties),
      editedAt: projects.editedAt,
    };
    const projectBetaSnapshot = {
      properties: structuredClone(projectBeta.properties),
      editedAt: projectBeta.editedAt,
    };
    projects.editedAt = NOTION_EDITED_AT;
    projects.properties.Notes = { id: "notes", name: "Notes", type: "rich_text", rich_text: {} };
    const phase = projects.properties.Phase as {
      status: { options: { id: string; name: string }[]; groups: unknown[] };
    };
    phase.status.options.push({ id: "phase-blocked", name: "Blocked" });
    // Notion linked Beta to a task; the new relation arrives with the refresh.
    projectBeta.properties.Tasks = {
      id: "tasks",
      type: "relation",
      relation: [{ id: ID.taskOne }],
    };
    projectBeta.editedAt = NOTION_EDITED_AT;

    // The importer's inferred board view is missing; the refresh restores it.
    await pool.query("DELETE FROM database_views WHERE type = 'board'");

    // Gamma was edited in KBS after Notion's last edit.
    await pool.query("UPDATE pages SET updated_at = $1 WHERE title = 'Gamma'", [KBS_EDITED_AT]);

    // A page added in Notion after the import must not be inserted.
    const journal = workspace.pages.get(ID.journal)!;
    journal.body = journal.body.filter(
      (item) => !("childPage" in item) || item.childPage !== ID.alpha,
    );
    journal.body.push({ childPage: ID.delta, title: "Delta" });
    workspace.pages.set(ID.delta, {
      id: ID.delta,
      title: "Delta",
      parentId: ID.journal,
      editedAt: NOTION_EDITED_AT,
      body: [{ text: "delta one" }],
    });
    // Later tests must see the imported workspace again, even if this one fails.
    t.after(() => {
      journal.body = journal.body.filter(
        (item) => !("childPage" in item) || item.childPage !== ID.delta,
      );
      workspace.pages.delete(ID.delta);
      alpha.title = alphaSnapshot.title;
      alpha.body = alphaSnapshot.body;
      alpha.editedAt = alphaSnapshot.editedAt;
      projects.properties = projectsSnapshot.properties;
      projects.editedAt = projectsSnapshot.editedAt;
      projectBeta.properties = projectBetaSnapshot.properties;
      projectBeta.editedAt = projectBetaSnapshot.editedAt;
    });

    const runResult = await run([...roots, "--update"]);
    assert.equal(runResult.status, 0, runResult.output);

    const updatedAlpha = await pageByTitle("Alpha renamed");
    assert.equal(updatedAlpha.content, "alpha two\nsee Gamma");
    assert.equal(updatedAlpha.updated_at.toISOString(), NOTION_EDITED_AT);

    // Timestamp gate: content differs but Notion did not report an edit.
    const untouchedBeta = await pageByTitle("Beta");
    assert.equal(untouchedBeta.content, "beta one");
    assert.equal(untouchedBeta.updated_at.toISOString(), IMPORTED_AT);

    // Local edits win: the newer KBS row is kept and reported.
    const keptGamma = await pageByTitle("Gamma");
    assert.equal(keptGamma.content, "gamma one");
    assert.equal(keptGamma.updated_at.toISOString(), KBS_EDITED_AT);

    // --update never inserts.
    const [pages] = await rows<{ count: number }>("SELECT count(*)::int AS count FROM pages");
    assert.equal(pages.count, 10);
    const [delta] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM pages WHERE title = 'Delta'",
    );
    assert.equal(delta.count, 0);

    assert.match(runResult.output, /pages:\s+10 checked, 1 updated/);
    assert.match(runResult.output, /not in KBS:\s+1 skipped \(1 pages, 0 records/);
    assert.match(runResult.output, /newer in KBS:\s+1 pages, 0 records kept their local edits/);
    assert.match(
      runResult.output,
      /page "Gamma": KBS 2026-03-01T00:00:00\.000Z, Notion 2026-01-01T00:00:00\.000Z/,
    );

    // Structure follows the same gate. Alpha moved under Beta, and its link to
    // Gamma became a page_links row; the page itself kept its new parent.
    const [betaPage] = await rows<PageRow>(
      `SELECT page.id, page.title, page.content, page.updated_at
       FROM pages AS page
       JOIN pages AS parent ON parent.id = page.parent_id
       WHERE page.title = 'Beta' AND parent.title = 'Journal'`,
    );
    assert.ok(betaPage);
    const [alphaParent] = await rows<{ parent_id: string | null }>(
      "SELECT parent_id FROM pages WHERE id = $1",
      [updatedAlpha.id],
    );
    assert.equal(alphaParent.parent_id, betaPage.id);

    const gammaPage = await pageByTitle("Gamma");
    const links = await rows<{ target_page_id: string }>(
      "SELECT target_page_id FROM page_links WHERE source_page_id = $1",
      [updatedAlpha.id],
    );
    assert.deepEqual(links.map((link) => link.target_page_id), [gammaPage.id]);

    // The relation Notion added now exists for Beta.
    const [betaRecord] = await rows<RecordRow>(
      "SELECT * FROM database_records WHERE title = 'Beta'",
    );
    assert.ok(betaRecord);
    const relations = await rows<{ target_record_id: string }>(
      "SELECT target_record_id FROM database_record_relations WHERE source_record_id = $1",
      [betaRecord.id],
    );
    assert.equal(relations.length, 1);

    // A property Notion added, and a choice it added, arrive with the schema.
    const byName = await properties();
    assert.equal(byName.get("Notes")?.type, "text");
    assert.deepEqual(byName.get("Phase")?.options, {
      choices: ["Backlog", "Doing", "Done", "Blocked"],
    });

    const [board] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM database_views WHERE type = 'board'",
    );
    assert.equal(board.count, 1);

    assert.match(
      runResult.output,
      /structure:\s+1 parents, 1 relations, 1 page links, 2 properties, 1 views/,
    );

    // Everything the update added is recorded, so a later --undo can remove
    // exactly those rows and files.
    const manifestLine = runResult.output.match(/Update manifest: (.+)/);
    assert.ok(manifestLine, "the update should write a manifest of what it added");
    updateManifestPath = manifestLine[1].trim();
    const updateManifest = JSON.parse(await readFile(updateManifestPath, "utf8"));
    assert.equal(updateManifest.run, "update");
    assert.equal(updateManifest.rows.databaseProperties.length, 1, "the Notes property");
    assert.equal(updateManifest.rows.databaseViews.length, 1, "the restored board view");
    assert.equal(
      updateManifest.rows.databaseRecordRelations.length,
      1,
      "Beta's new relation",
    );
    assert.equal(updateManifest.rows.pageLinks.length, 1, "Alpha's link to Gamma");
    assert.equal(updateManifest.rows.attachments.length, 1, "Alpha's new image");
    assert.equal(updateManifest.files.length, 1);
    assert.equal(updateManifest.attachmentSources.length, 1);
  });

  it("--update reports pages Notion trashed instead of keeping them silently", async (t) => {
    const beta = workspace.pages.get(ID.beta)!;
    const journal = workspace.pages.get(ID.journal)!;
    const journalBody = [...journal.body];
    beta.trashed = true;
    t.after(() => {
      beta.trashed = false;
      journal.body = journalBody;
    });

    const stillListed = await run([...roots, "--update"]);
    assert.equal(stillListed.status, 0, stillListed.output);
    assert.match(stillListed.output, /trashed in Notion:\s+1 found, 1 still in KBS \(kept\)/);
    assert.match(stillListed.output, /page "Beta"/);

    // Notion omits a trashed page from its parent's children, so the walk no
    // longer reaches it. The stored Notion id has to find it instead.
    journal.body = journal.body.filter(
      (item) => !("childPage" in item) || item.childPage !== ID.beta,
    );
    const vanished = await run([...roots, "--update"]);
    assert.equal(vanished.status, 0, vanished.output);
    assert.match(vanished.output, /trashed in Notion:\s+1 found, 1 still in KBS \(kept\)/);
    assert.match(vanished.output, /page "Beta"/);

    const [kept] = await rows<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM pages AS page
       JOIN pages AS parent ON parent.id = page.parent_id
       WHERE page.title = 'Beta' AND parent.title = 'Journal'`,
    );
    assert.equal(kept.count, 1, "a trashed page is reported, not deleted");
  });

  it("--retry-files records the file and the reference rewrite it adds", async (t) => {
    fake.serveLateImage(true);
    t.after(() => fake.serveLateImage(false));

    const retry = await run([...roots, "--retry-files"]);
    assert.equal(retry.status, 0, retry.output);
    const manifestLine = retry.output.match(/Retry manifest: (.+)/);
    assert.ok(manifestLine, "the retry should write a manifest of the file it stored");
    retryManifestPath = manifestLine[1].trim();

    const manifest = JSON.parse(await readFile(retryManifestPath, "utf8"));
    assert.equal(manifest.run, "retry-files");
    assert.equal(manifest.rows.attachments.length, 1);
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.attachmentSources.length, 1);
    const attachmentId = manifest.rows.attachments[0] as string;
    assert.ok(await stat(path.join(harness.attachmentsDir, attachmentId)));

    const [journal] = await rows<{ content_json: Json }>(
      "SELECT content_json FROM pages WHERE title = 'Journal'",
    );
    assert.match(
      JSON.stringify(journal.content_json),
      new RegExp(`/api/attachments/${attachmentId}`),
    );

    const undo = await run(["--undo", retryManifestPath, "--yes"]);
    assert.equal(undo.status, 0, undo.output);
    assert.match(undo.output, /content:\s+1 attachment references restored to Notion/);

    const [left] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM attachments WHERE id = $1",
      [attachmentId],
    );
    assert.equal(left.count, 0);
    await assert.rejects(stat(path.join(harness.attachmentsDir, attachmentId)));
    const [restored] = await rows<{ content_json: Json }>(
      "SELECT content_json FROM pages WHERE title = 'Journal'",
    );
    assert.match(JSON.stringify(restored.content_json), /\/files\/late\.png/);
  });

  it("--verify passes on a complete import and fails on missing rows and files", async () => {
    const complete = await run([...roots, "--verify"]);
    assert.equal(complete.status, 0, complete.output);
    assert.match(complete.output, /No mismatches/);

    // Simulate a damaged import: a property row and the attachment bytes are gone.
    await pool.query("DELETE FROM database_properties WHERE name = 'Remainder'");
    const importManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const importedAttachmentId = importManifest.rows.attachments[0] as string;
    assert.ok(importedAttachmentId);
    const attachmentFile = path.join(harness.attachmentsDir, importedAttachmentId);
    assert.ok(await stat(attachmentFile));
    await rm(attachmentFile);

    const damaged = await run([...roots, "--verify"]);
    assert.equal(damaged.status, 1, damaged.output);
    assert.match(damaged.output, /1 of 11 properties is missing from KBS/);
    assert.match(damaged.output, /1 of 1 attachment .*missing from/);
  });

  it("--undo removes the rows and files --update added", async () => {
    const manifest = JSON.parse(await readFile(updateManifestPath, "utf8"));
    const attachmentId = manifest.rows.attachments[0] as string;
    assert.ok(await stat(path.join(harness.attachmentsDir, attachmentId)));

    const undo = await run(["--undo", updateManifestPath, "--yes"]);
    assert.equal(undo.status, 0, undo.output);

    assert.equal((await properties()).has("Notes"), false);
    const [board] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM database_views WHERE type = 'board'",
    );
    assert.equal(board.count, 0);
    const [betaRecord] = await rows<{ id: string }>(
      "SELECT id FROM database_records WHERE title = 'Beta'",
    );
    const [relations] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM database_record_relations WHERE source_record_id = $1",
      [betaRecord.id],
    );
    assert.equal(relations.count, 0);
    const [links] = await rows<{ count: number }>("SELECT count(*)::int AS count FROM page_links");
    assert.equal(links.count, 0);
    const [left] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM attachments WHERE id = $1",
      [attachmentId],
    );
    assert.equal(left.count, 0);
    await assert.rejects(stat(path.join(harness.attachmentsDir, attachmentId)));

    // Refreshed content still exists, so its image points at Notion again
    // instead of at an attachment that was just deleted.
    const [alpha] = await rows<{ content_json: Json }>(
      "SELECT content_json FROM pages WHERE title = 'Alpha renamed'",
    );
    assert.match(JSON.stringify(alpha.content_json), /\/files\/photo\.png/);
    assert.doesNotMatch(JSON.stringify(alpha.content_json), new RegExp(attachmentId));
  });

  it("--undo previews first, deletes only the recorded rows, and refuses a second undo", async () => {
    const preview = await run(["--undo", manifestPath, "--dry-run"]);
    assert.equal(preview.status, 0, preview.output);
    assert.match(preview.output, /Dry run: nothing was deleted/);

    const [before] = await rows<{ count: number }>("SELECT count(*)::int AS count FROM pages");
    assert.equal(before.count, 10);
    const [mappedBefore] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM notion_objects",
    );
    assert.equal(mappedBefore.count, 10, "the import recorded Notion ids to forget");

    const undo = await run(["--undo", manifestPath, "--yes"]);
    assert.equal(undo.status, 0, undo.output);
    assert.match(undo.output, /pages:\s+10 of 10/);
    // The file is either still on disk (deleted here) or already gone (when the
    // verification test removed it); both are a complete undo.
    assert.match(undo.output, /(?:1 deleted|1 already gone)/);
    assert.match(undo.output, /\(marked undone\)/);

    for (const table of [
      "pages",
      "databases",
      "database_properties",
      "database_views",
      "database_records",
      "attachments",
      "notion_objects",
    ]) {
      const [left] = await rows<{ count: number }>(`SELECT count(*)::int AS count FROM "${table}"`);
      assert.equal(left.count, 0, `${table} should be empty after --undo`);
    }

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.ok(manifest.undoneAt);

    const again = await run(["--undo", manifestPath, "--yes"]);
    assert.equal(again.status, 1);
    assert.match(again.output, /already undone/);
  });

  it("--prune-trashed previews and removes only the objects Notion trashed", async (t) => {
    // The undo above emptied the workspace, so import again; this test is last
    // and leaves the workspace pruned.
    const reimport = await run([...roots, "--manifest", reimportManifestPath]);
    assert.equal(reimport.status, 0, reimport.output);

    // The mapping is the precise row prune acts on, independent of where the
    // re-import placed Alpha in the page tree.
    const [alphaMapping] = await rows<{ kbs_id: string }>(
      "SELECT kbs_id FROM notion_objects WHERE notion_id = $1 AND kind = 'page'",
      [ID.alpha],
    );
    assert.ok(alphaMapping, "the re-import should record Alpha's Notion id");

    const alpha = workspace.pages.get(ID.alpha)!;
    const projects = workspace.databases.get(ID.projectsDatabase)!;
    const taskOne = workspace.databases
      .get(ID.tasksDatabase)!
      .records.find((record) => record.id === ID.taskOne)!;
    alpha.trashed = true;
    projects.trashed = true;
    taskOne.trashed = true;
    t.after(() => {
      alpha.trashed = false;
      projects.trashed = false;
      taskOne.trashed = false;
    });

    const dry = await run(["--prune-trashed", "--dry-run"]);
    assert.equal(dry.status, 0, dry.output);
    assert.match(dry.output, /trashed in Notion:\s+3/);
    assert.match(dry.output, /page "Alpha"/);
    assert.match(dry.output, /record "Task one"/);
    assert.match(dry.output, /database "Projects"/);
    assert.match(dry.output, /Dry run: nothing was removed/);

    const [untouched] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM pages WHERE deleted_at IS NULL",
    );
    assert.equal(untouched.count, 10, "a dry run must not change anything");

    // Removing data needs the same typed confirmation as --undo.
    const unconfirmed = await run(["--prune-trashed"]);
    assert.equal(unconfirmed.status, 1, unconfirmed.output);
    assert.match(unconfirmed.output, /Re-run with --yes/);

    const prune = await run(["--prune-trashed", "--yes"]);
    assert.equal(prune.status, 0, prune.output);
    assert.match(prune.output, /pages:\s+5 moved to the KBS trash/);
    assert.match(prune.output, /records:\s+3 removed/);
    assert.match(prune.output, /databases:\s+1 removed/);

    // Pages go to the trash, the way the trash button does, so restoring one
    // stays possible; the rest of the imported tree is untouched.
    const [alphaState] = await rows<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM pages WHERE id = $1",
      [alphaMapping.kbs_id],
    );
    assert.ok(alphaState.deleted_at, "a trashed Notion page is soft-deleted in KBS");
    const [taskPage] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM pages WHERE title = 'Task one' AND deleted_at IS NOT NULL",
    );
    assert.equal(taskPage.count, 1, "a removed record's page goes to the trash");
    const [groupingPage] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM pages WHERE title = 'Projects' AND deleted_at IS NOT NULL",
    );
    assert.equal(groupingPage.count, 1, "a removed database's grouping page goes to the trash");
    const [beta] = await rows<{ deleted_at: Date | null; content: string }>(
      "SELECT deleted_at, content FROM pages WHERE title = 'Beta'",
    );
    assert.equal(beta.deleted_at, null, "an object Notion did not trash is left alone");
    // Beta's body is the one the earlier --update test wrote from Notion.
    assert.match(beta.content, /^beta two/);

    // Records and databases have no trash table, so their rows are gone.
    const records = await rows<{ title: string }>(
      "SELECT title FROM database_records ORDER BY title",
    );
    assert.deepEqual(records.map((record) => record.title), ["Task two"]);
    const databases = await rows<{ name: string }>("SELECT name FROM databases ORDER BY name");
    assert.deepEqual(databases.map((database) => database.name), ["Tasks"]);

    // The Notion ids of everything removed are forgotten with its rows.
    const [mapped] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM notion_objects",
    );
    assert.equal(mapped.count, 5);

    const [files] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM attachments",
    );
    assert.equal(files.count, 1, "attachment bytes are kept for the trash to clean up");

    // What was removed is captured, so a later run can put it back.
    const manifestLine = prune.output.match(/Prune manifest: (.+)/);
    assert.ok(manifestLine, "the prune should record what it removed");
    pruneManifestPath = manifestLine[1].trim();
    const pruneManifest = JSON.parse(await readFile(pruneManifestPath, "utf8"));
    assert.equal(pruneManifest.format, "kbs-prune-manifest");
    assert.equal(pruneManifest.totals.pages, 5);
    assert.equal(pruneManifest.totals.databases, 1);
    assert.equal(pruneManifest.totals.records, 3);
    assert.equal(pruneManifest.totals.properties, 10, "every Projects property");
    assert.equal(pruneManifest.totals.views, 2, "the Projects table and board");
    assert.equal(pruneManifest.rows.databases.length, 1);
    assert.equal(pruneManifest.rows.databaseRecords.length, 3);
    assert.equal(pruneManifest.rows.databaseRecordRelations.length, 2);
    assert.equal(pruneManifest.rows.notionObjects.length, 5);

    // The restore previews without writing, then replays the manifest.
    const restoreDry = await run(["--restore", pruneManifestPath, "--dry-run"]);
    assert.equal(restoreDry.status, 0, restoreDry.output);
    assert.match(restoreDry.output, /Dry run: nothing was restored/);
    const [stillPruned] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM databases",
    );
    assert.equal(stillPruned.count, 1, "a restore dry run must not change anything");

    const restore = await run(["--restore", pruneManifestPath]);
    assert.equal(restore.status, 0, restore.output);
    assert.match(restore.output, /pages:\s+5 of 5 un-trashed/);
    assert.match(restore.output, /databases:\s+1 of 1/);
    assert.match(restore.output, /records:\s+3 of 3/);

    const [live] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM pages WHERE deleted_at IS NULL",
    );
    assert.equal(live.count, 10, "every trashed page is un-trashed");
    const [taskPageAgain] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM pages WHERE title = 'Task one' AND deleted_at IS NULL",
    );
    assert.equal(taskPageAgain.count, 1, "a removed record's page comes back");
    const [databasesAgain] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM databases",
    );
    assert.equal(databasesAgain.count, 2);
    const [recordsAgain] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM database_records",
    );
    assert.equal(recordsAgain.count, 4);
    const [relationsAgain] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM database_record_relations",
    );
    assert.equal(relationsAgain.count, 2);
    const [propertiesAgain] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM database_properties",
    );
    assert.equal(propertiesAgain.count, 11);
    const [viewsAgain] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM database_views",
    );
    assert.equal(viewsAgain.count, 3);
    const [mappedAgain] = await rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM notion_objects",
    );
    assert.equal(mappedAgain.count, 10, "the Notion ids come back with their rows");

    // Un-trashing restores the pre-prune timestamp, so --update still compares
    // against Notion's edit time instead of treating the page as new work.
    const [alphaUpdated] = await rows<{ updated_at: Date }>(
      "SELECT updated_at FROM pages WHERE id = $1",
      [alphaMapping.kbs_id],
    );
    assert.equal(alphaUpdated.updated_at.toISOString(), IMPORTED_AT);

    const restoredManifest = JSON.parse(await readFile(pruneManifestPath, "utf8"));
    assert.ok(restoredManifest.restoredAt);

    const restoreAgain = await run(["--restore", pruneManifestPath]);
    assert.equal(restoreAgain.status, 1);
    assert.match(restoreAgain.output, /already restored/);
  });
});
