import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { asc, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { databaseRecords as databaseRecordTable, pages as pagesTable } from "../../src/db/schema";
import { createTestDatabase, type TestDatabase } from "./db-harness";

type ApiModules = {
  pages: typeof import("../../src/app/api/pages/route");
  page: typeof import("../../src/app/api/pages/[id]/route");
  move: typeof import("../../src/app/api/pages/move/route");
  reorder: typeof import("../../src/app/api/pages/reorder/route");
  revisions: typeof import("../../src/app/api/pages/[id]/revisions/route");
  pageTags: typeof import("../../src/app/api/pages/[id]/tags/route");
  links: typeof import("../../src/app/api/pages/[id]/links/route");
  pageRecords: typeof import("../../src/app/api/pages/[id]/records/route");
  recordPages: typeof import("../../src/app/api/records/[recordId]/pages/route");
  connections: typeof import("../../src/app/api/orphans/route");
  tags: typeof import("../../src/app/api/tags/route");
  graph: typeof import("../../src/app/api/graph/route");
  records: typeof import("../../src/app/api/databases/[id]/records/route");
  inbox: typeof import("../../src/app/api/inbox/route");
  inboxItem: typeof import("../../src/app/api/inbox/[id]/route");
  attachments: typeof import("../../src/app/api/attachments/route");
  attachment: typeof import("../../src/app/api/attachments/[id]/route");
  orphans: typeof import("../../src/app/api/attachments/orphans/route");
  databases: typeof import("../../src/app/api/databases/route");
  database: typeof import("../../src/app/api/databases/[id]/route");
  properties: typeof import("../../src/app/api/databases/[id]/properties/route");
  views: typeof import("../../src/app/api/databases/[id]/views/route");
  view: typeof import("../../src/app/api/databases/[id]/views/[viewId]/route");
  viewUsage: typeof import("../../src/app/api/databases/[id]/views/[viewId]/usage/route");
  templates: typeof import("../../src/app/api/databases/[id]/templates/route");
  template: typeof import("../../src/app/api/databases/[id]/templates/[templateId]/route");
  pageTemplatesList: typeof import("../../src/app/api/page-templates/route");
  pageTemplate: typeof import("../../src/app/api/page-templates/[id]/route");
  record: typeof import("../../src/app/api/databases/[id]/records/[recordId]/route");
  dashboard: typeof import("../../src/app/api/dashboard/route");
  search: typeof import("../../src/app/api/search/route");
  exportWorkspace: typeof import("../../src/app/api/export/route");
  trash: typeof import("../../src/app/api/trash/route");
  trashItem: typeof import("../../src/app/api/trash/[id]/route");
  trashRestore: typeof import("../../src/app/api/trash/[id]/restore/route");
};

type Json = Record<string, unknown>;
type PageRow = { id: string; title: string; content: string; isInbox: boolean; parentId: string | null };
type TagRow = { id: string; name: string };
type AttachmentRow = { id: string; url: string; filename: string; mimeType: string; size: number };

let harness: TestDatabase;
let pool: Pool;
let db: typeof import("../../src/db").db;
let api: ApiModules;

const MISSING_ID = "99999999-9999-4999-8999-999999999999";

function jsonRequest(pathname: string, method: string, body?: unknown) {
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function formRequest(pathname: string, form: FormData) {
  return new Request(`http://localhost${pathname}`, { method: "POST", body: form });
}

function routeContext<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

async function body<T = Json>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function createPage(overrides: Json = {}): Promise<PageRow> {
  const response = await api.pages.POST(jsonRequest("/api/pages", "POST", overrides));
  assert.equal(response.status, 201);
  return await body<PageRow>(response);
}

async function createDatabase(name: string): Promise<{ id: string; name: string }> {
  const response = await api.databases.POST(jsonRequest("/api/databases", "POST", { name }));
  assert.equal(response.status, 201);
  return await body<{ id: string; name: string }>(response);
}

async function createDatabaseProperty(databaseId: string, input: Json): Promise<{ id: string; name: string; type: string; options: Json }> {
  const response = await api.properties.POST(
    jsonRequest(`/api/databases/${databaseId}/properties`, "POST", input),
    routeContext({ id: databaseId }),
  );
  assert.equal(response.status, 201);
  return await body(response);
}

async function createDatabaseRecord(databaseId: string, input: Json = {}): Promise<{
  id: string;
  title: string;
  pageId: string;
  values: Json;
  relations: Record<string, string[]>;
}> {
  const response = await api.records.POST(
    jsonRequest(`/api/databases/${databaseId}/records`, "POST", input),
    routeContext({ id: databaseId }),
  );
  assert.equal(response.status, 201);
  return await body(response);
}

function uploadForm(file: File, purpose?: "image") {
  const form = new FormData();
  if (purpose) form.append("purpose", purpose);
  form.append("file", file);
  return form;
}

async function childOrder(parentId: string) {
  const rows = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(eq(pagesTable.parentId, parentId))
    .orderBy(asc(pagesTable.sortOrder));
  return rows.map((row) => row.id);
}

async function inboxFlags(id: string) {
  const [row] = await db.select({ isInbox: pagesTable.isInbox }).from(pagesTable).where(eq(pagesTable.id, id));
  return row;
}

before(async () => {
  harness = await createTestDatabase();
  process.env.DATABASE_URL = harness.url;
  process.env.ATTACHMENTS_DIR = harness.attachmentsDir;

  const dbModule = await import("../../src/db");
  pool = dbModule.pool;
  db = dbModule.db;

  const [
    pages,
    page,
    move,
    reorder,
    revisions,
    pageTags,
    links,
    tags,
    graph,
    records,
    inbox,
    inboxItem,
    attachments,
    attachment,
    orphans,
    databases,
    database,
    properties,
    views,
    view,
    viewUsage,
    templates,
    template,
    pageTemplatesList,
    pageTemplate,
    record,
    dashboard,
    search,
    exportWorkspace,
    trash,
    trashItem,
    trashRestore,
    pageRecords,
    recordPages,
    connections,
  ] = await Promise.all([
    import("../../src/app/api/pages/route"),
    import("../../src/app/api/pages/[id]/route"),
    import("../../src/app/api/pages/move/route"),
    import("../../src/app/api/pages/reorder/route"),
    import("../../src/app/api/pages/[id]/revisions/route"),
    import("../../src/app/api/pages/[id]/tags/route"),
    import("../../src/app/api/pages/[id]/links/route"),
    import("../../src/app/api/tags/route"),
    import("../../src/app/api/graph/route"),
    import("../../src/app/api/databases/[id]/records/route"),
    import("../../src/app/api/inbox/route"),
    import("../../src/app/api/inbox/[id]/route"),
    import("../../src/app/api/attachments/route"),
    import("../../src/app/api/attachments/[id]/route"),
    import("../../src/app/api/attachments/orphans/route"),
    import("../../src/app/api/databases/route"),
    import("../../src/app/api/databases/[id]/route"),
    import("../../src/app/api/databases/[id]/properties/route"),
    import("../../src/app/api/databases/[id]/views/route"),
    import("../../src/app/api/databases/[id]/views/[viewId]/route"),
    import("../../src/app/api/databases/[id]/views/[viewId]/usage/route"),
    import("../../src/app/api/databases/[id]/templates/route"),
    import("../../src/app/api/databases/[id]/templates/[templateId]/route"),
    import("../../src/app/api/page-templates/route"),
    import("../../src/app/api/page-templates/[id]/route"),
    import("../../src/app/api/databases/[id]/records/[recordId]/route"),
    import("../../src/app/api/dashboard/route"),
    import("../../src/app/api/search/route"),
    import("../../src/app/api/export/route"),
    import("../../src/app/api/trash/route"),
    import("../../src/app/api/trash/[id]/route"),
    import("../../src/app/api/trash/[id]/restore/route"),
    import("../../src/app/api/pages/[id]/records/route"),
    import("../../src/app/api/records/[recordId]/pages/route"),
    import("../../src/app/api/orphans/route"),
  ]);

  api = { pages, page, move, reorder, revisions, pageTags, links, tags, graph, records, inbox, inboxItem, attachments, attachment, orphans, databases, database, properties, views, view, viewUsage, templates, template, pageTemplatesList, pageTemplate, record, dashboard, search, exportWorkspace, trash, trashItem, trashRestore, pageRecords, recordPages, connections };
});

after(async () => {
  if (harness) await harness.dispose(pool);
});

describe("attachments API", () => {
  it("rejects an upload without a file", async () => {
    const response = await api.attachments.POST(formRequest("/api/attachments", new FormData()));

    assert.equal(response.status, 400);
    assert.match(String((await body(response)).error), /Choose a file/);
  });

  it("rejects unsupported types and empty files", async () => {
    const text = await api.attachments.POST(formRequest(
      "/api/attachments",
      uploadForm(new File([new Uint8Array([1])], "note.txt", { type: "text/plain" })),
    ));
    assert.equal(text.status, 400);
    assert.match(String((await body(text)).error), /not supported/);

    const empty = await api.attachments.POST(formRequest(
      "/api/attachments",
      uploadForm(new File([], "empty.png", { type: "image/png" })),
    ));
    assert.equal(empty.status, 400);
    assert.match(String((await body(empty)).error), /between 1 byte/);
  });

  it("only accepts images when the upload is for an image field", async () => {
    const pdfAsImage = await api.attachments.POST(formRequest(
      "/api/attachments",
      uploadForm(new File([new Uint8Array([1, 2, 3])], "doc.pdf", { type: "application/pdf" }), "image"),
    ));
    assert.equal(pdfAsImage.status, 400);

    const pdfAsFile = await api.attachments.POST(formRequest(
      "/api/attachments",
      uploadForm(new File([new Uint8Array([1, 2, 3])], "doc.pdf", { type: "application/pdf" })),
    ));
    assert.equal(pdfAsFile.status, 201, "PDFs are allowed outside image fields");
  });

  it("stores an upload on disk and serves it back with safe headers", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const response = await api.attachments.POST(formRequest(
      "/api/attachments",
      uploadForm(new File([bytes], "cover.png", { type: "image/png" }), "image"),
    ));

    assert.equal(response.status, 201);
    const attachment = await body<AttachmentRow>(response);
    assert.equal(attachment.url, `/api/attachments/${attachment.id}`);
    assert.equal(attachment.filename, "cover.png");
    assert.equal(attachment.mimeType, "image/png");
    assert.equal(attachment.size, bytes.byteLength);
    assert.deepEqual(
      new Uint8Array(await readFile(path.join(harness.attachmentsDir, attachment.id))),
      bytes,
    );

    const download = await api.attachment.GET(
      jsonRequest(attachment.url, "GET"),
      routeContext({ id: attachment.id }),
    );
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "image/png");
    assert.equal(download.headers.get("content-length"), String(bytes.byteLength));
    assert.equal(download.headers.get("content-disposition"), 'inline; filename="cover.png"');
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
  });

  it("rejects malformed and unknown attachment ids", async () => {
    assert.equal(
      (await api.attachment.GET(jsonRequest("/api/attachments/nope", "GET"), routeContext({ id: "nope" }))).status,
      400,
    );
    assert.equal(
      (await api.attachment.GET(jsonRequest(`/api/attachments/${MISSING_ID}`, "GET"), routeContext({ id: MISSING_ID }))).status,
      404,
    );
  });

  it("finds orphaned attachments but keeps ones referenced by a page", async () => {
    const orphan = await body<AttachmentRow>(await api.attachments.POST(formRequest(
      "/api/attachments",
      uploadForm(new File([new Uint8Array([1])], "orphan.png", { type: "image/png" }), "image"),
    )));
    const kept = await body<AttachmentRow>(await api.attachments.POST(formRequest(
      "/api/attachments",
      uploadForm(new File([new Uint8Array([2])], "kept.png", { type: "image/png" }), "image"),
    )));

    const coverPage = await createPage({ title: "Attachment cover" });
    const patched = await api.page.PATCH(
      jsonRequest(`/api/pages/${coverPage.id}`, "PATCH", { coverImageUrl: kept.url }),
      routeContext({ id: coverPage.id }),
    );
    assert.equal(patched.status, 200);

    const scan = await body<{ count: number; items: { id: string }[] }>(await api.orphans.GET(jsonRequest("/api/connections", "GET")));
    assert.ok(scan.items.some((item) => item.id === orphan.id), "unreferenced files should be reported");
    assert.ok(!scan.items.some((item) => item.id === kept.id), "a page cover should protect its file");

    const clean = await body<{ removed: number }>(await api.orphans.DELETE(jsonRequest("/api/connections", "DELETE")));
    assert.ok(clean.removed >= 1);

    const afterCleanup = await body<{ items: { id: string }[] }>(await api.orphans.GET(jsonRequest("/api/connections", "GET")));
    assert.ok(!afterCleanup.items.some((item) => item.id === orphan.id));
    assert.equal(
      (await api.attachment.GET(jsonRequest(kept.url, "GET"), routeContext({ id: kept.id }))).status,
      200,
      "referenced files must survive cleanup",
    );
  });
});

describe("page quote API", () => {
  it("corrects and clears the passage captured with a page", async () => {
    const page = await createPage({ title: "Captured article", content: "Notes" });

    const corrected = await api.page.PATCH(
      jsonRequest(`/api/pages/${page.id}`, "PATCH", { selectedText: "  A corrected passage.  " }),
      routeContext({ id: page.id }),
    );
    assert.equal(corrected.status, 200);
    assert.equal(
      (await body<{ selectedText: string | null }>(corrected)).selectedText,
      "A corrected passage.",
      "a correction is stored with its surrounding whitespace trimmed",
    );

    const cleared = await api.page.PATCH(
      jsonRequest(`/api/pages/${page.id}`, "PATCH", { selectedText: "   " }),
      routeContext({ id: page.id }),
    );
    assert.equal(cleared.status, 200);
    assert.equal(
      (await body<{ selectedText: string | null }>(cleared)).selectedText,
      null,
      "an emptied quote is stored as no quote at all",
    );

    const reloaded = await body<{ selectedText: string | null }>(
      await api.page.GET(jsonRequest(`/api/pages/${page.id}`, "GET"), routeContext({ id: page.id })),
    );
    assert.equal(reloaded.selectedText, null, "the cleared quote stays cleared on reload");
  });

  it("rejects a passage longer than 2000 characters", async () => {
    const page = await createPage({ title: "Long quote" });

    const response = await api.page.PATCH(
      jsonRequest(`/api/pages/${page.id}`, "PATCH", { selectedText: "x".repeat(2_001) }),
      routeContext({ id: page.id }),
    );

    assert.equal(response.status, 400);
  });
});

describe("inbox API", () => {
  it("requires a title, note, or URL", async () => {
    const response = await api.inbox.POST(jsonRequest("/api/inbox", "POST", {}));

    assert.equal(response.status, 400);
    assert.equal((await body(response)).error, "Add a title, note, or URL to capture.");
  });

  it("rejects non-HTTP source URLs", async () => {
    const response = await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
      sourceUrl: "ftp://example.com/file",
    }));

    assert.equal(response.status, 400);
    assert.equal((await body(response)).error, "URL must use HTTP or HTTPS.");
  });

  it("captures a note with a default title and editable document", async () => {
    const response = await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
      content: "Captured thought",
    }));

    assert.equal(response.status, 201);
    const item = await body<PageRow & { contentJson: { type: string; content: { type: string; content: { text: string }[] }[] } }>(response);
    assert.equal(item.title, "Quick note");
    assert.equal(item.content, "Captured thought");
    assert.equal(item.isInbox, true);
    assert.equal(item.contentJson.type, "doc");
    assert.equal(item.contentJson.content[0]?.type, "paragraph");
    assert.equal(item.contentJson.content[0]?.content[0]?.text, "Captured thought");
  });

  it("stores optional selected text with a saved link", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("offline"); };
    try {
      const response = await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
        sourceUrl: "https://example.com/essay",
        selectedText: "  A passage worth keeping.  ",
      }));

      assert.equal(response.status, 201);
      const item = await body<PageRow & { selectedText: string | null }>(response);
      assert.equal(item.selectedText, "A passage worth keeping.", "surrounding whitespace is trimmed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("leaves selected text null when the capture has none", async () => {
    const response = await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
      content: "No quote here",
    }));

    assert.equal(response.status, 201);
    assert.equal((await body<{ selectedText: string | null }>(response)).selectedText, null);
  });

  it("rejects selected text longer than 2000 characters", async () => {
    const response = await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
      sourceUrl: "https://example.com/essay",
      selectedText: "x".repeat(2_001),
    }));

    assert.equal(response.status, 400);
  });

  it("does not treat a quote alone as a capture", async () => {
    const response = await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
      selectedText: "Just a quote",
    }));

    assert.equal(response.status, 400);
    assert.equal((await body(response)).error, "Add a title, note, or URL to capture.");
  });

  it("derives a title from the source URL host when the page cannot be read", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("offline"); };
    try {
      const response = await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
        sourceUrl: "https://example.com/read-later",
      }));

      assert.equal(response.status, 201);
      const item = await body<PageRow & { sourceUrl: string; linkPreview: unknown }>(response);
      assert.equal(item.title, "example.com");
      assert.equal(item.sourceUrl, "https://example.com/read-later");
      assert.equal(item.linkPreview, null, "an unreadable page leaves no preview");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stores link metadata read from the captured page", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(`<html><head>
      <meta property="og:title" content="Episode 4 recap" />
      <meta property="og:description" content="What we watched this week." />
      <meta property="og:site_name" content="Example Reads" />
      <meta property="og:image" content="https://example.com/cover.jpg" />
      <link rel="icon" href="/favicon.png" />
    </head></html>`, { status: 200, headers: { "content-type": "text/html" } });
    try {
      const response = await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
        sourceUrl: "http://93.184.216.34/episode-4",
      }));

      assert.equal(response.status, 201);
      const item = await body<{
        title: string;
        linkPreview: { title: string; description: string; siteName: string; imageUrl: string; faviconUrl: string };
      }>(response);
      assert.equal(item.title, "Episode 4 recap", "the page title names the capture");
      assert.equal(item.linkPreview.description, "What we watched this week.");
      assert.equal(item.linkPreview.siteName, "Example Reads");
      assert.equal(item.linkPreview.imageUrl, "https://example.com/cover.jpg");
      assert.equal(item.linkPreview.faviconUrl, "http://93.184.216.34/favicon.png");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("lists inbox items only and removes them when organized", async () => {
    const captured = await body<PageRow>(await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
      title: "Organize me",
      content: "Some notes",
    })));
    const normal = await createPage({ title: "Regular page" });

    const beforeList = await body<PageRow[]>(await api.inbox.GET(jsonRequest("/api/inbox", "GET")));
    assert.ok(beforeList.some((item) => item.id === captured.id));
    assert.ok(!beforeList.some((item) => item.id === normal.id), "regular pages are not inbox items");

    const organized = await api.inboxItem.PATCH(
      jsonRequest(`/api/inbox/${captured.id}`, "PATCH"),
      routeContext({ id: captured.id }),
    );
    assert.equal(organized.status, 200);
    assert.deepEqual(await body(organized), { id: captured.id, isInbox: false });
    assert.equal((await inboxFlags(captured.id))?.isInbox, false);

    const repeat = await api.inboxItem.PATCH(
      jsonRequest(`/api/inbox/${captured.id}`, "PATCH"),
      routeContext({ id: captured.id }),
    );
    assert.equal(repeat.status, 404, "organizing twice should 404");

    assert.equal(
      (await api.inboxItem.PATCH(jsonRequest("/api/inbox/nope", "PATCH"), routeContext({ id: "nope" }))).status,
      400,
    );
  });

  it("moves an inbox item into a database using matching properties", async () => {
    const database = await body<{ id: string }>(await api.databases.POST(jsonRequest("/api/databases", "POST", {
      name: "Reading queue",
    })));
    const urlProperty = await body<{ id: string }>(await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", { name: "Source", type: "url" }),
      routeContext({ id: database.id }),
    ));
    const noteProperty = await body<{ id: string }>(await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", { name: "Notes", type: "text" }),
      routeContext({ id: database.id }),
    ));
    const dateProperty = await body<{ id: string }>(await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", { name: "Captured", type: "date" }),
      routeContext({ id: database.id }),
    ));

    const item = await body<PageRow>(await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
      sourceUrl: "https://example.com/read-later",
      content: "Remember this",
    })));
    const response = await api.inboxItem.POST(
      jsonRequest(`/api/inbox/${item.id}`, "POST", { databaseId: database.id }),
      routeContext({ id: item.id }),
    );

    assert.equal(response.status, 201);
    const record = await body<{ title: string; pageId: string; values: Record<string, unknown> }>(response);
    assert.equal(record.title, "example.com");
    assert.equal(record.pageId, item.id);
    assert.equal(record.values[urlProperty.id], "https://example.com/read-later");
    assert.equal(record.values[noteProperty.id], "Remember this");
    assert.match(String(record.values[dateProperty.id]), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal((await inboxFlags(item.id))?.isInbox, false, "the page leaves the inbox");

    assert.equal(
      (await api.inboxItem.POST(
        jsonRequest(`/api/inbox/${item.id}`, "POST", { databaseId: database.id }),
        routeContext({ id: item.id }),
      )).status,
      404,
      "an organized item cannot be filed twice",
    );
    assert.equal(
      (await api.inboxItem.POST(
        jsonRequest(`/api/inbox/${item.id}`, "POST", { databaseId: "not-a-uuid" }),
        routeContext({ id: item.id }),
      )).status,
      400,
    );
  });
});

describe("page ordering API", () => {
  it("rejects malformed reorder requests and unknown pages", async () => {
    assert.equal(
      (await api.reorder.POST(jsonRequest("/api/pages/reorder", "POST", { pageId: "nope", direction: "up" }))).status,
      400,
    );
    assert.equal(
      (await api.reorder.POST(jsonRequest("/api/pages/reorder", "POST", {
        pageId: MISSING_ID,
        direction: "up",
      }))).status,
      404,
    );
  });

  it("swaps sibling order and treats the boundary as a no-op", async () => {
    const parent = await createPage({ title: "Reorder parent" });
    const first = await createPage({ title: "First", parentId: parent.id });
    const second = await createPage({ title: "Second", parentId: parent.id });
    const third = await createPage({ title: "Third", parentId: parent.id });
    assert.deepEqual(await childOrder(parent.id), [first.id, second.id, third.id]);

    const moved = await api.reorder.POST(jsonRequest("/api/pages/reorder", "POST", {
      pageId: second.id,
      direction: "up",
    }));
    assert.equal(moved.status, 200);
    assert.deepEqual(await childOrder(parent.id), [second.id, first.id, third.id]);

    const atBoundary = await api.reorder.POST(jsonRequest("/api/pages/reorder", "POST", {
      pageId: second.id,
      direction: "up",
    }));
    assert.equal(atBoundary.status, 200);
    assert.deepEqual(await childOrder(parent.id), [second.id, first.id, third.id]);
  });

  it("rejects moves into the page itself or its descendants", async () => {
    const parent = await createPage({ title: "Move parent" });
    const child = await createPage({ title: "Move child", parentId: parent.id });

    assert.equal(
      (await api.move.POST(jsonRequest("/api/pages/move", "POST", {
        pageId: parent.id,
        newParentId: parent.id,
        position: "inside",
      }))).status,
      400,
    );
    assert.equal(
      (await api.move.POST(jsonRequest("/api/pages/move", "POST", {
        pageId: parent.id,
        newParentId: child.id,
        position: "inside",
      }))).status,
      400,
    );
    assert.equal(
      (await api.move.POST(jsonRequest("/api/pages/move", "POST", {
        pageId: MISSING_ID,
        newParentId: null,
        position: "after",
      }))).status,
      404,
    );
    assert.equal(
      (await api.move.POST(jsonRequest("/api/pages/move", "POST", { pageId: parent.id }))).status,
      400,
      "position is required",
    );
  });

  it("moves a page inside a new parent and reorders siblings", async () => {
    const parent = await createPage({ title: "Move destination" });
    const a = await createPage({ title: "A", parentId: parent.id });
    const b = await createPage({ title: "B", parentId: parent.id });
    const c = await createPage({ title: "C", parentId: parent.id });

    const inside = await api.move.POST(jsonRequest("/api/pages/move", "POST", {
      pageId: b.id,
      newParentId: a.id,
      targetPageId: a.id,
      position: "inside",
    }));
    assert.equal(inside.status, 200);
    assert.deepEqual(await childOrder(parent.id), [a.id, c.id]);
    assert.deepEqual(await childOrder(a.id), [b.id]);

    const before = await api.move.POST(jsonRequest("/api/pages/move", "POST", {
      pageId: c.id,
      newParentId: parent.id,
      targetPageId: a.id,
      position: "before",
    }));
    assert.equal(before.status, 200);
    assert.deepEqual(await childOrder(parent.id), [c.id, a.id]);
  });

  it("refuses to reorder pages that are not siblings", async () => {
    const firstParent = await createPage({ title: "Sibling parent one" });
    const secondParent = await createPage({ title: "Sibling parent two" });
    const firstChild = await createPage({ title: "Sibling child one", parentId: firstParent.id });
    await createPage({ title: "Sibling child two", parentId: secondParent.id });

    const response = await api.move.POST(jsonRequest("/api/pages/move", "POST", {
      pageId: firstChild.id,
      newParentId: secondParent.id,
      targetPageId: firstChild.id,
      position: "before",
    }));
    assert.equal(response.status, 400);
  });
});

describe("page revisions API", () => {
  it("rejects malformed requests", async () => {
    assert.equal(
      (await api.revisions.GET(jsonRequest("/api/pages/nope/revisions", "GET"), routeContext({ id: "nope" }))).status,
      400,
    );
    assert.equal(
      (await api.revisions.GET(jsonRequest(`/api/pages/${MISSING_ID}/revisions`, "GET"), routeContext({ id: MISSING_ID }))).status,
      404,
    );
    const page = await createPage({ title: "Revision validation" });
    assert.equal(
      (await api.revisions.POST(
        jsonRequest(`/api/pages/${page.id}/revisions`, "POST", { revisionId: "nope" }),
        routeContext({ id: page.id }),
      )).status,
      400,
    );
  });

  it("records the previous content and restores it", async () => {
    const page = await createPage({ title: "Revision page", content: "first draft" });
    const edited = await api.page.PATCH(
      jsonRequest(`/api/pages/${page.id}`, "PATCH", { content: "second draft" }),
      routeContext({ id: page.id }),
    );
    assert.equal(edited.status, 200);

    const revisions = await body<{ id: string; title: string; content: string }[]>(
      await api.revisions.GET(jsonRequest(`/api/pages/${page.id}/revisions`, "GET"), routeContext({ id: page.id })),
    );
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].title, "Revision page");
    assert.equal(revisions[0].content, "first draft");

    const restored = await api.revisions.POST(
      jsonRequest(`/api/pages/${page.id}/revisions`, "POST", { revisionId: revisions[0].id }),
      routeContext({ id: page.id }),
    );
    assert.equal(restored.status, 200);
    const restoredPage = await body<PageRow>(restored);
    assert.equal(restoredPage.title, "Revision page");
    assert.equal(restoredPage.content, "first draft");

    const afterRestore = await body<{ content: string }[]>(
      await api.revisions.GET(jsonRequest(`/api/pages/${page.id}/revisions`, "GET"), routeContext({ id: page.id })),
    );
    assert.equal(afterRestore.length, 2, "restoring keeps the replaced version as a revision");
    assert.equal(afterRestore[0].content, "second draft");

    const reloaded = await body<PageRow>(
      await api.page.GET(jsonRequest(`/api/pages/${page.id}`, "GET"), routeContext({ id: page.id })),
    );
    assert.equal(reloaded.content, "first draft");
  });

  it("refuses a revision that belongs to another page", async () => {
    const source = await createPage({ title: "Revision source page", content: "v1" });
    await api.page.PATCH(
      jsonRequest(`/api/pages/${source.id}`, "PATCH", { content: "v2" }),
      routeContext({ id: source.id }),
    );
    const [revision] = await body<{ id: string }[]>(
      await api.revisions.GET(jsonRequest(`/api/pages/${source.id}/revisions`, "GET"), routeContext({ id: source.id })),
    );

    const other = await createPage({ title: "Revision other page", content: "kept" });
    const response = await api.revisions.POST(
      jsonRequest(`/api/pages/${other.id}/revisions`, "POST", { revisionId: revision.id }),
      routeContext({ id: other.id }),
    );

    assert.equal(response.status, 404);
    assert.equal((await body(response)).error, "Revision not found");
    const unchanged = await body<PageRow>(
      await api.page.GET(jsonRequest(`/api/pages/${other.id}`, "GET"), routeContext({ id: other.id })),
    );
    assert.equal(unchanged.content, "kept", "a foreign revision must not overwrite the page");
  });
});

describe("graph API", () => {
  it("returns live pages with hierarchy and link edges", async () => {
    const parent = await createPage({ title: "Graph parent" });
    const child = await createPage({ title: "Graph child", parentId: parent.id });
    const source = await createPage({ title: "Graph source" });
    const target = await createPage({ title: "Graph target" });

    const linked = await api.links.POST(
      jsonRequest(`/api/pages/${source.id}/links`, "POST", { targetPageId: target.id }),
      routeContext({ id: source.id }),
    );
    assert.equal(linked.status, 201);

    const graph = await body<{ nodes: { id: string }[]; edges: { source: string; target: string; type: string }[] }>(
      await api.graph.GET(jsonRequest("/api/graph", "GET")),
    );
    assert.ok(graph.nodes.some((node) => node.id === parent.id));
    assert.ok(graph.nodes.some((node) => node.id === child.id));
    assert.ok(graph.edges.some((edge) =>
      edge.source === parent.id && edge.target === child.id && edge.type === "hierarchy"));
    assert.ok(graph.edges.some((edge) =>
      edge.source === source.id && edge.target === target.id && edge.type === "link"),
      "explicit page links become graph edges");

    await api.page.DELETE(jsonRequest(`/api/pages/${child.id}`, "DELETE"), routeContext({ id: child.id }));
    const afterTrash = await body<{ nodes: { id: string }[]; edges: { target: string }[] }>(await api.graph.GET(jsonRequest("/api/graph", "GET")));
    assert.ok(!afterTrash.nodes.some((node) => node.id === child.id), "trashed pages leave the graph");
    assert.ok(!afterTrash.edges.some((edge) => edge.target === child.id));

    await api.page.DELETE(jsonRequest(`/api/pages/${target.id}`, "DELETE"), routeContext({ id: target.id }));
    const afterTargetTrash = await body<{ edges: { target: string }[] }>(await api.graph.GET(jsonRequest("/api/graph", "GET")));
    assert.ok(!afterTargetTrash.edges.some((edge) => edge.target === target.id),
      "links to trashed pages are hidden");
  });

  it("can omit record pages from the workspace graph", async () => {
    const database = await body<{ id: string }>(await api.databases.POST(jsonRequest("/api/databases", "POST", {
      name: "Graph record pages",
    })));
    const created = await api.records.POST(
      jsonRequest(`/api/databases/${database.id}/records`, "POST", { title: "Graph record page" }),
      routeContext({ id: database.id }),
    );
    assert.equal(created.status, 201);
    const record = await body<{ pageId: string }>(created);
    const source = await createPage({ title: "Graph record source" });
    await api.links.POST(
      jsonRequest(`/api/pages/${source.id}/links`, "POST", { targetPageId: record.pageId }),
      routeContext({ id: source.id }),
    );

    const all = await body<{
      nodes: { id: string; isRecordPage: boolean }[];
      edges: { source: string; target: string }[];
    }>(await api.graph.GET(jsonRequest("/api/graph", "GET")));
    assert.ok(all.nodes.some((node) => node.id === record.pageId && node.isRecordPage),
      "record pages remain available to consumers that need the marker");
    assert.ok(all.edges.some((edge) => edge.source === source.id && edge.target === record.pageId));

    const filtered = await body<{
      nodes: { id: string }[];
      edges: { source: string; target: string }[];
    }>(await api.graph.GET(jsonRequest("/api/graph?excludeRecordPages=true", "GET")));
    assert.ok(!filtered.nodes.some((node) => node.id === record.pageId),
      "record pages leave the workspace graph");
    assert.ok(!filtered.edges.some((edge) => edge.source === record.pageId || edge.target === record.pageId),
      "edges touching record pages are removed too");
  });
});

describe("page link origins API", () => {
  it("keeps a panel connection when an inline link is cleaned up", async () => {
    const source = await createPage({ title: "Connection source" });
    const target = await createPage({ title: "Connection target" });

    const inline = await api.links.POST(
      jsonRequest(`/api/pages/${source.id}/links`, "POST", { targetPageId: target.id, origin: "inline" }),
      routeContext({ id: source.id }),
    );
    assert.equal(inline.status, 201);

    const promoted = await api.links.POST(
      jsonRequest(`/api/pages/${source.id}/links`, "POST", { targetPageId: target.id }),
      routeContext({ id: source.id }),
    );
    assert.equal(promoted.status, 201);

    const cleanup = await api.links.DELETE(
      jsonRequest(`/api/pages/${source.id}/links`, "DELETE", { targetPageId: target.id, origin: "inline" }),
      routeContext({ id: source.id }),
    );
    assert.equal(cleanup.status, 200);

    const remaining = await body<{ links: { id: string }[] }>(
      await api.links.GET(jsonRequest(`/api/pages/${source.id}/links`, "GET"), routeContext({ id: source.id })),
    );
    assert.ok(
      remaining.links.some((link) => link.id === target.id),
      "a deliberate panel connection outlives inline-link cleanup",
    );
  });

  it("deletes an inline connection when its link is removed", async () => {
    const source = await createPage({ title: "Inline connection source" });
    const target = await createPage({ title: "Inline connection target" });

    await api.links.POST(
      jsonRequest(`/api/pages/${source.id}/links`, "POST", { targetPageId: target.id, origin: "inline" }),
      routeContext({ id: source.id }),
    );
    const removal = await api.links.DELETE(
      jsonRequest(`/api/pages/${source.id}/links`, "DELETE", { targetPageId: target.id }),
      routeContext({ id: source.id }),
    );
    assert.equal(removal.status, 200);

    const remaining = await body<{ links: { id: string }[] }>(
      await api.links.GET(jsonRequest(`/api/pages/${source.id}/links`, "GET"), routeContext({ id: source.id })),
    );
    assert.ok(!remaining.links.some((link) => link.id === target.id));
  });
});

describe("page and record connections API", () => {
  it("shares one connection between the page and the record", async () => {
    const page = await createPage({ title: "Connection page" });
    const database = await createDatabase("Connection database");
    const record = await createDatabaseRecord(database.id, { title: "Connection record" });

    const linked = await api.pageRecords.POST(
      jsonRequest(`/api/pages/${page.id}/records`, "POST", { recordId: record.id }),
      routeContext({ id: page.id }),
    );
    assert.equal(linked.status, 201);

    const pageView = await body<{
      records: { id: string; databaseName: string }[];
      options: { id: string }[];
    }>(await api.pageRecords.GET(
      jsonRequest(`/api/pages/${page.id}/records`, "GET"),
      routeContext({ id: page.id }),
    ));
    assert.ok(pageView.records.some((row) => row.id === record.id));
    assert.equal(
      pageView.records.find((row) => row.id === record.id)?.databaseName,
      "Connection database",
    );
    assert.ok(!pageView.options.some((row) => row.id === record.id), "a linked record leaves the picker");

    const recordView = await body<{ pages: { id: string }[] }>(await api.recordPages.GET(
      jsonRequest(`/api/records/${record.id}/pages`, "GET"),
      routeContext({ recordId: record.id }),
    ));
    assert.ok(
      recordView.pages.some((row) => row.id === page.id),
      "the record lists the page that linked to it",
    );
  });

  it("creates the same connection from the record side and removes it from either side", async () => {
    const page = await createPage({ title: "Reverse connection page" });
    const database = await createDatabase("Reverse connection database");
    const record = await createDatabaseRecord(database.id, { title: "Reverse connection record" });

    const linked = await api.recordPages.POST(
      jsonRequest(`/api/records/${record.id}/pages`, "POST", { pageId: page.id }),
      routeContext({ recordId: record.id }),
    );
    assert.equal(linked.status, 201);

    const pageView = await body<{ records: { id: string }[] }>(await api.pageRecords.GET(
      jsonRequest(`/api/pages/${page.id}/records`, "GET"),
      routeContext({ id: page.id }),
    ));
    assert.ok(pageView.records.some((row) => row.id === record.id));

    const duplicate = await api.recordPages.POST(
      jsonRequest(`/api/records/${record.id}/pages`, "POST", { pageId: page.id }),
      routeContext({ recordId: record.id }),
    );
    assert.equal(duplicate.status, 201);
    const afterDuplicate = await body<{ records: { id: string }[] }>(await api.pageRecords.GET(
      jsonRequest(`/api/pages/${page.id}/records`, "GET"),
      routeContext({ id: page.id }),
    ));
    assert.equal(
      afterDuplicate.records.filter((row) => row.id === record.id).length,
      1,
      "linking the same record twice keeps one connection",
    );

    const removed = await api.pageRecords.DELETE(
      jsonRequest(`/api/pages/${page.id}/records`, "DELETE", { recordId: record.id }),
      routeContext({ id: page.id }),
    );
    assert.equal(removed.status, 200);

    const recordView = await body<{ pages: { id: string }[] }>(await api.recordPages.GET(
      jsonRequest(`/api/records/${record.id}/pages`, "GET"),
      routeContext({ recordId: record.id }),
    ));
    assert.ok(!recordView.pages.some((row) => row.id === page.id));
  });

  it("rejects self-links, unknown targets, and malformed bodies", async () => {
    const page = await createPage({ title: "Connection validation page" });
    const database = await createDatabase("Connection validation database");
    const record = await createDatabaseRecord(database.id, { title: "Connection validation record" });

    const ownPage = await api.pageRecords.POST(
      jsonRequest(`/api/pages/${record.pageId}/records`, "POST", { recordId: record.id }),
      routeContext({ id: record.pageId }),
    );
    assert.equal(ownPage.status, 400);

    const ownPageFromRecord = await api.recordPages.POST(
      jsonRequest(`/api/records/${record.id}/pages`, "POST", { pageId: record.pageId }),
      routeContext({ recordId: record.id }),
    );
    assert.equal(ownPageFromRecord.status, 400);

    const missingRecord = await api.pageRecords.POST(
      jsonRequest(`/api/pages/${page.id}/records`, "POST", { recordId: MISSING_ID }),
      routeContext({ id: page.id }),
    );
    assert.equal(missingRecord.status, 404);

    const missingPage = await api.recordPages.POST(
      jsonRequest(`/api/records/${record.id}/pages`, "POST", { pageId: MISSING_ID }),
      routeContext({ recordId: record.id }),
    );
    assert.equal(missingPage.status, 404);

    const malformed = await api.pageRecords.POST(
      jsonRequest(`/api/pages/${page.id}/records`, "POST", { recordId: "nope" }),
      routeContext({ id: page.id }),
    );
    assert.equal(malformed.status, 400);

    const badId = await api.pageRecords.GET(
      jsonRequest("/api/pages/nope/records", "GET"),
      routeContext({ id: "nope" }),
    );
    assert.equal(badId.status, 400);
  });

  it("drops a connection when its record is deleted", async () => {
    const page = await createPage({ title: "Cascade connection page" });
    const database = await createDatabase("Cascade connection database");
    const record = await createDatabaseRecord(database.id, { title: "Cascade connection record" });
    await api.pageRecords.POST(
      jsonRequest(`/api/pages/${page.id}/records`, "POST", { recordId: record.id }),
      routeContext({ id: page.id }),
    );

    await api.record.DELETE(
      jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "DELETE"),
      routeContext({ id: database.id, recordId: record.id }),
    );

    const pageView = await body<{ records: { id: string }[] }>(await api.pageRecords.GET(
      jsonRequest(`/api/pages/${page.id}/records`, "GET"),
      routeContext({ id: page.id }),
    ));
    assert.ok(
      !pageView.records.some((row) => row.id === record.id),
      "deleting a record removes the connection it owned",
    );
  });
});

describe("orphan view API", () => {
  it("lists unconnected pages and records, and drops them once connected", async () => {
    const page = await createPage({ title: "Orphan probe page" });
    const database = await createDatabase("Orphan probe database");
    const record = await createDatabaseRecord(database.id, { title: "Orphan probe record" });

    const first = await body<{
      pages: { id: string }[];
      records: { id: string; databaseId: string; databaseName: string }[];
      total: number;
    }>(await api.connections.GET(jsonRequest("/api/connections", "GET")));
    assert.ok(first.pages.some((row) => row.id === page.id));
    assert.ok(
      !first.pages.some((row) => row.id === record.pageId),
      "a record's own page is reported as a record, not a page",
    );
    const orphanRecord = first.records.find((row) => row.id === record.id);
    assert.ok(orphanRecord);
    assert.equal(orphanRecord?.databaseId, database.id);
    assert.equal(orphanRecord?.databaseName, "Orphan probe database");
    assert.equal(first.total, first.pages.length + first.records.length);

    await api.pageRecords.POST(
      jsonRequest(`/api/pages/${page.id}/records`, "POST", { recordId: record.id }),
      routeContext({ id: page.id }),
    );

    const afterLink = await body<{ pages: { id: string }[]; records: { id: string }[] }>(
      await api.connections.GET(jsonRequest("/api/connections", "GET")),
    );
    assert.ok(!afterLink.pages.some((row) => row.id === page.id), "a page with a record link is connected");
    assert.ok(!afterLink.records.some((row) => row.id === record.id), "a record with a page link is connected");
  });

  it("treats tags, hierarchy, and relations as connections", async () => {
    const parent = await createPage({ title: "Connected parent probe" });
    const child = await createPage({ title: "Connected child probe", parentId: parent.id });
    const tagged = await createPage({ title: "Connected tag probe" });
    const tag = await body<{ id: string }>(
      await api.tags.POST(jsonRequest("/api/tags", "POST", { name: "Orphan probe tag" })),
    );
    const assigned = await api.pageTags.POST(
      jsonRequest(`/api/pages/${tagged.id}/tags`, "POST", { tagId: tag.id }),
      routeContext({ id: tagged.id }),
    );
    assert.equal(assigned.status, 200);

    const database = await createDatabase("Relation probe database");
    const relation = await createDatabaseProperty(database.id, {
      name: "Related",
      type: "relation",
      options: { relatedDatabaseId: database.id },
    });
    const source = await createDatabaseRecord(database.id, { title: "Relation probe source" });
    const target = await createDatabaseRecord(database.id, { title: "Relation probe target" });
    const patched = await api.record.PATCH(
      jsonRequest(`/api/databases/${database.id}/records/${source.id}`, "PATCH", {
        relations: { [relation.id]: [target.id] },
      }),
      routeContext({ id: database.id, recordId: source.id }),
    );
    assert.equal(patched.status, 200);

    const scan = await body<{ pages: { id: string }[]; records: { id: string }[] }>(
      await api.connections.GET(jsonRequest("/api/connections", "GET")),
    );
    const pageIds = new Set(scan.pages.map((row) => row.id));
    assert.ok(!pageIds.has(parent.id), "a page with a child is connected");
    assert.ok(!pageIds.has(child.id), "a child page is connected to its parent");
    assert.ok(!pageIds.has(tagged.id), "a tagged page is connected");

    const recordIds = new Set(scan.records.map((row) => row.id));
    assert.ok(!recordIds.has(source.id), "a record pointing at another record is connected");
    assert.ok(!recordIds.has(target.id), "a record targeted by a relation is connected");
  });
});

describe("tags API", () => {
  it("lists tags in name order and treats duplicates as the same tag", async () => {
    const created = await api.tags.POST(jsonRequest("/api/tags", "POST", { name: "Zebra tag" }));
    assert.equal(created.status, 201);
    const zebra = await body<TagRow>(created);

    const duplicate = await api.tags.POST(jsonRequest("/api/tags", "POST", { name: "Zebra tag" }));
    assert.equal(duplicate.status, 200);
    assert.equal((await body<TagRow>(duplicate)).id, zebra.id);

    await api.tags.POST(jsonRequest("/api/tags", "POST", { name: "Apple tag" }));
    const tags = await body<TagRow[]>(await api.tags.GET(jsonRequest("/api/tags", "GET")));
    const names = tags.map((tag) => tag.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), "tags come back sorted by name");
  });

  it("rejects an empty tag name", async () => {
    const response = await api.tags.POST(jsonRequest("/api/tags", "POST", { name: "   " }));

    assert.equal(response.status, 400);
    assert.match(String((await body(response)).error), /between 1 and 50/);
  });

  it("assigns and removes page tags idempotently", async () => {
    const page = await createPage({ title: "Tagged page" });
    const tag = await body<TagRow>(await api.tags.POST(jsonRequest("/api/tags", "POST", { name: "Assign me" })));

    const assigned = await api.pageTags.POST(
      jsonRequest(`/api/pages/${page.id}/tags`, "POST", { tagId: tag.id }),
      routeContext({ id: page.id }),
    );
    assert.equal(assigned.status, 200);
    assert.equal(
      (await api.pageTags.POST(
        jsonRequest(`/api/pages/${page.id}/tags`, "POST", { tagId: tag.id }),
        routeContext({ id: page.id }),
      )).status,
      200,
      "assigning twice is idempotent",
    );

    const tagsOnPage = await body<TagRow[]>(
      await api.pageTags.GET(jsonRequest(`/api/pages/${page.id}/tags`, "GET"), routeContext({ id: page.id })),
    );
    assert.equal(tagsOnPage.filter((entry) => entry.id === tag.id).length, 1);

    const removed = await api.pageTags.DELETE(
      jsonRequest(`/api/pages/${page.id}/tags`, "DELETE", { tagId: tag.id }),
      routeContext({ id: page.id }),
    );
    assert.equal(removed.status, 200);
    assert.deepEqual(
      await body(
        await api.pageTags.GET(jsonRequest(`/api/pages/${page.id}/tags`, "GET"), routeContext({ id: page.id })),
      ),
      [],
    );
  });

  it("validates tag assignment targets", async () => {
    const page = await createPage({ title: "Tag validation page" });
    const tag = await body<TagRow>(await api.tags.POST(jsonRequest("/api/tags", "POST", { name: "Validation tag" })));

    assert.equal(
      (await api.pageTags.POST(jsonRequest(`/api/pages/${page.id}/tags`, "POST", { tagId: "nope" }), routeContext({ id: page.id }))).status,
      400,
    );
    assert.equal(
      (await api.pageTags.GET(jsonRequest("/api/pages/nope/tags", "GET"), routeContext({ id: "nope" }))).status,
      400,
    );
    assert.equal(
      (await api.pageTags.POST(jsonRequest(`/api/pages/${MISSING_ID}/tags`, "POST", { tagId: tag.id }), routeContext({ id: MISSING_ID }))).status,
      404,
    );
    assert.equal(
      (await api.pageTags.POST(jsonRequest(`/api/pages/${page.id}/tags`, "POST", { tagId: MISSING_ID }), routeContext({ id: page.id }))).status,
      404,
    );
    assert.equal(
      (await api.pageTags.DELETE(jsonRequest(`/api/pages/${page.id}/tags`, "DELETE", {}), routeContext({ id: page.id }))).status,
      400,
    );
  });
});

describe("database metadata API", () => {
  it("renames a database and rejects invalid updates", async () => {
    const database = await body<{ id: string }>(await api.databases.POST(jsonRequest("/api/databases", "POST", {
      name: "Metadata database",
    })));

    const renamed = await api.database.PATCH(
      jsonRequest(`/api/databases/${database.id}`, "PATCH", { name: "Renamed database", description: "Notes" }),
      routeContext({ id: database.id }),
    );
    assert.equal(renamed.status, 200);
    assert.equal((await body<{ name: string; description: string }>(renamed)).name, "Renamed database");

    assert.equal(
      (await api.database.PATCH(jsonRequest(`/api/databases/${database.id}`, "PATCH", {}), routeContext({ id: database.id }))).status,
      400,
    );
    assert.equal(
      (await api.database.PATCH(jsonRequest(`/api/databases/${MISSING_ID}`, "PATCH", { name: "x" }), routeContext({ id: MISSING_ID }))).status,
      404,
    );
  });

  it("validates relation and rollup property definitions", async () => {
    const database = await body<{ id: string }>(await api.databases.POST(jsonRequest("/api/databases", "POST", {
      name: "Property validation",
    })));
    const context = routeContext({ id: database.id });

    const unsupported = await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", { name: "Bad", type: "timeline" }),
      context,
    );
    assert.equal(unsupported.status, 400);

    const relationWithoutTarget = await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", { name: "Related", type: "relation" }),
      context,
    );
    assert.equal(relationWithoutTarget.status, 400);

    const rollupWithoutRelation = await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", {
        name: "Total",
        type: "rollup",
        options: { aggregation: "sum" },
      }),
      context,
    );
    assert.equal(rollupWithoutRelation.status, 400);

    const relation = await body<{ id: string }>(await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", { name: "Linked", type: "relation", options: { relatedDatabaseId: database.id } }),
      context,
    ));
    const badAggregation = await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", {
        name: "Total",
        type: "rollup",
        options: { relationPropertyId: relation.id, aggregation: "median", targetPropertyId: relation.id },
      }),
      context,
    );
    assert.equal(badAggregation.status, 400);
  });

  it("validates formula property definitions", async () => {
    const database = await body<{ id: string }>(await api.databases.POST(jsonRequest("/api/databases", "POST", {
      name: "Formula validation",
    })));
    const context = routeContext({ id: database.id });

    assert.equal((await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", { name: "Watched", type: "number" }),
      context,
    )).status, 201);
    assert.equal((await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", { name: "Notes", type: "text" }),
      context,
    )).status, 201);

    const missingExpression = await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", { name: "Progress", type: "formula" }),
      context,
    );
    assert.equal(missingExpression.status, 400, "a formula needs an expression");

    const broken = await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", {
        name: "Progress",
        type: "formula",
        options: { expression: "{Watched} /" },
      }),
      context,
    );
    assert.equal(broken.status, 400, "an unparseable expression is refused");

    const unknownReference = await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", {
        name: "Progress",
        type: "formula",
        options: { expression: "{Missing} * 2" },
      }),
      context,
    );
    assert.equal(unknownReference.status, 400, "formulas cannot reference missing properties");

    const nonNumericReference = await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", {
        name: "Progress",
        type: "formula",
        options: { expression: "{Notes} * 2" },
      }),
      context,
    );
    assert.equal(nonNumericReference.status, 400, "formulas only read number and rollup properties");

    const created = await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", {
        name: "Progress",
        type: "formula",
        options: { expression: "round({Watched} / 24 * 100, 1)" },
      }),
      context,
    );
    assert.equal(created.status, 201);
    const formula = await body<{ type: string; options: { expression: string } }>(created);
    assert.equal(formula.type, "formula");
    assert.equal(formula.options.expression, "round({Watched} / 24 * 100, 1)");
  });

  it("deletes templates only from their own database", async () => {
    const owner = await body<{ id: string }>(await api.databases.POST(jsonRequest("/api/databases", "POST", {
      name: "Template owner",
    })));
    const other = await body<{ id: string }>(await api.databases.POST(jsonRequest("/api/databases", "POST", {
      name: "Template other",
    })));
    const createdTemplate = await api.templates.POST(
      jsonRequest(`/api/databases/${owner.id}/templates`, "POST", {
        name: "Starter",
        title: "From template",
        values: {},
      }),
      routeContext({ id: owner.id }),
    );
    assert.equal(createdTemplate.status, 201, "the template fixture should be created");
    const template = await body<{ id: string }>(createdTemplate);

    const wrongDatabase = await api.template.DELETE(
      jsonRequest(`/api/databases/${other.id}/templates/${template.id}`, "DELETE"),
      routeContext({ id: other.id, templateId: template.id }),
    );
    assert.equal(wrongDatabase.status, 404, "templates are scoped to their database");

    const deleted = await api.template.DELETE(
      jsonRequest(`/api/databases/${owner.id}/templates/${template.id}`, "DELETE"),
      routeContext({ id: owner.id, templateId: template.id }),
    );
    assert.equal(deleted.status, 200);
    assert.deepEqual(await body(deleted), { success: true });

    const again = await api.template.DELETE(
      jsonRequest(`/api/databases/${owner.id}/templates/${template.id}`, "DELETE"),
      routeContext({ id: owner.id, templateId: template.id }),
    );
    assert.equal(again.status, 404);

    const invalid = await api.template.DELETE(
      jsonRequest("/api/databases/nope/templates/nope", "DELETE"),
      routeContext({ id: "nope", templateId: "nope" }),
    );
    assert.equal(invalid.status, 400);
  });

  it("deletes a view only from its own database and keeps the last view", async () => {
    const owner = await body<{ id: string }>(await api.databases.POST(jsonRequest("/api/databases", "POST", {
      name: "View owner",
    })));
    const other = await body<{ id: string }>(await api.databases.POST(jsonRequest("/api/databases", "POST", {
      name: "View other",
    })));
    const recordResponse = await api.records.POST(
      jsonRequest(`/api/databases/${owner.id}/records`, "POST", { title: "Keep me" }),
      routeContext({ id: owner.id }),
    );
    assert.equal(recordResponse.status, 201, "the record fixture should be created");

    const created = await api.views.POST(
      jsonRequest(`/api/databases/${owner.id}/views`, "POST", {
        name: "Calendar",
        type: "calendar",
        config: { datePropertyId: "date" },
      }),
      routeContext({ id: owner.id }),
    );
    assert.equal(created.status, 201, "the second view fixture should be created");
    const calendar = await body<{ id: string }>(created);

    const wrongDatabase = await api.view.DELETE(
      jsonRequest(`/api/databases/${other.id}/views/${calendar.id}`, "DELETE"),
      routeContext({ id: other.id, viewId: calendar.id }),
    );
    assert.equal(wrongDatabase.status, 404, "views are scoped to their database");

    const deleted = await api.view.DELETE(
      jsonRequest(`/api/databases/${owner.id}/views/${calendar.id}`, "DELETE"),
      routeContext({ id: owner.id, viewId: calendar.id }),
    );
    assert.equal(deleted.status, 200);
    assert.deepEqual(await body(deleted), { success: true });

    const ownerData = await body<{ views: { id: string }[]; records: { title: string }[] }>(
      await api.database.GET(jsonRequest(`/api/databases/${owner.id}`, "GET"), routeContext({ id: owner.id })),
    );
    assert.equal(ownerData.views.length, 1);
    assert.ok(!ownerData.views.some((view) => view.id === calendar.id));
    assert.ok(ownerData.records.some((record) => record.title === "Keep me"), "deleting a view must not delete records");

    const lastView = ownerData.views[0];
    const refused = await api.view.DELETE(
      jsonRequest(`/api/databases/${owner.id}/views/${lastView.id}`, "DELETE"),
      routeContext({ id: owner.id, viewId: lastView.id }),
    );
    assert.equal(refused.status, 409);
    assert.match(String((await body(refused)).error), /at least one view/);

    const stillThere = await body<{ views: { id: string }[] }>(
      await api.database.GET(jsonRequest(`/api/databases/${owner.id}`, "GET"), routeContext({ id: owner.id })),
    );
    assert.deepEqual(stillThere.views.map((view) => view.id), [lastView.id]);

    const invalid = await api.view.DELETE(
      jsonRequest("/api/databases/nope/views/nope", "DELETE"),
      routeContext({ id: "nope", viewId: "nope" }),
    );
    assert.equal(invalid.status, 400);

    const missing = await api.view.DELETE(
      jsonRequest(`/api/databases/${owner.id}/views/${MISSING_ID}`, "DELETE"),
      routeContext({ id: owner.id, viewId: MISSING_ID }),
    );
    assert.equal(missing.status, 404);
  });

  it("reports live pages that use a view, including first-view fallbacks", async () => {
    const owner = await body<{ id: string }>(await api.databases.POST(jsonRequest("/api/databases", "POST", {
      name: "Usage owner",
    })));
    const other = await body<{ id: string }>(await api.databases.POST(jsonRequest("/api/databases", "POST", {
      name: "Usage other",
    })));
    const calendar = await body<{ id: string }>(await api.views.POST(
      jsonRequest(`/api/databases/${owner.id}/views`, "POST", {
        name: "Calendar",
        type: "calendar",
        config: { datePropertyId: "date" },
      }),
      routeContext({ id: owner.id }),
    ));
    const ownerData = await body<{ views: { id: string; type: string }[] }>(
      await api.database.GET(jsonRequest(`/api/databases/${owner.id}`, "GET"), routeContext({ id: owner.id })),
    );
    const tableView = ownerData.views.find((view) => view.type === "table");
    assert.ok(tableView, "a table view fixture should exist");

    const embeddingPage = await createPage({ title: "Embedded notes" });
    const otherPage = await createPage({ title: "Other view notes" });
    const fallbackPage = await createPage({ title: "Fallback notes" });
    const stalePage = await createPage({ title: "Stale view notes" });
    const embedDocument = (databaseId: string, viewId: string | null) => ({
      type: "doc",
      content: [{
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{ type: "databaseEmbed", attrs: { databaseId, viewId } }],
        }],
      }],
    });

    assert.equal((await api.page.PATCH(
      jsonRequest(`/api/pages/${embeddingPage.id}`, "PATCH", { contentJson: embedDocument(owner.id, calendar.id) }),
      routeContext({ id: embeddingPage.id }),
    )).status, 200);
    assert.equal((await api.page.PATCH(
      jsonRequest(`/api/pages/${otherPage.id}`, "PATCH", { contentJson: embedDocument(owner.id, tableView.id) }),
      routeContext({ id: otherPage.id }),
    )).status, 200);
    assert.equal((await api.page.PATCH(
      jsonRequest(`/api/pages/${fallbackPage.id}`, "PATCH", { contentJson: embedDocument(owner.id, null) }),
      routeContext({ id: fallbackPage.id }),
    )).status, 200);
    assert.equal((await api.page.PATCH(
      jsonRequest(`/api/pages/${stalePage.id}`, "PATCH", { contentJson: embedDocument(owner.id, MISSING_ID) }),
      routeContext({ id: stalePage.id }),
    )).status, 200);

    const createTemplate = async (name: string, viewId: string | null) => {
      const response = await api.pageTemplatesList.POST(jsonRequest("/api/page-templates", "POST", {
        name,
        contentJson: embedDocument(owner.id, viewId),
      }));
      assert.equal(response.status, 201, "the template fixture should be created");
      return await body<{ id: string; name: string }>(response);
    };
    const calendarTemplate = await createTemplate("Calendar template", calendar.id);
    const tableTemplate = await createTemplate("Table template", tableView.id);
    const fallbackTemplate = await createTemplate("Fallback template", null);

    const tableUsage = await api.viewUsage.GET(
      jsonRequest(`/api/databases/${owner.id}/views/${tableView.id}/usage`, "GET"),
      routeContext({ id: owner.id, viewId: tableView.id }),
    );
    assert.equal(tableUsage.status, 200);
    const tableUsagePages = await body<{ pages: { title: string }[]; templates: { id: string; name: string }[] }>(tableUsage);
    assert.deepEqual(
      tableUsagePages.pages.map((page) => page.title).sort(),
      ["Fallback notes", "Other view notes", "Stale view notes"],
      "the first view is used by missing and stale embed selections",
    );
    assert.deepEqual(
      tableUsagePages.templates
        .map((template) => ({ id: template.id, name: template.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      [
        { id: fallbackTemplate.id, name: "Fallback template" },
        { id: tableTemplate.id, name: "Table template" },
      ],
      "templates also use the first-view fallback",
    );

    const usage = await api.viewUsage.GET(
      jsonRequest(`/api/databases/${owner.id}/views/${calendar.id}/usage`, "GET"),
      routeContext({ id: owner.id, viewId: calendar.id }),
    );
    assert.equal(usage.status, 200);
    assert.deepEqual(await body(usage), {
      pages: [{ id: embeddingPage.id, title: "Embedded notes" }],
      templates: [{ id: calendarTemplate.id, name: "Calendar template" }],
    });

    await api.page.DELETE(
      jsonRequest(`/api/pages/${embeddingPage.id}`, "DELETE"),
      routeContext({ id: embeddingPage.id }),
    );
    const afterTrash = await api.viewUsage.GET(
      jsonRequest(`/api/databases/${owner.id}/views/${calendar.id}/usage`, "GET"),
      routeContext({ id: owner.id, viewId: calendar.id }),
    );
    assert.deepEqual(await body(afterTrash), {
      pages: [],
      templates: [{ id: calendarTemplate.id, name: "Calendar template" }],
    });

    assert.equal((await api.viewUsage.GET(
      jsonRequest(`/api/databases/${other.id}/views/${calendar.id}/usage`, "GET"),
      routeContext({ id: other.id, viewId: calendar.id }),
    )).status, 404);
    assert.equal((await api.viewUsage.GET(
      jsonRequest("/api/databases/nope/views/nope/usage", "GET"),
      routeContext({ id: "nope", viewId: "nope" }),
    )).status, 400);
    assert.equal((await api.viewUsage.GET(
      jsonRequest(`/api/databases/${owner.id}/views/${MISSING_ID}/usage`, "GET"),
      routeContext({ id: owner.id, viewId: MISSING_ID }),
    )).status, 404);
  });
});

describe("page templates API", () => {
  it("creates, lists, and deletes page templates", async () => {
    const created = await api.pageTemplatesList.POST(jsonRequest("/api/page-templates", "POST", {
      name: "Meeting notes",
      title: "Meeting notes",
      content: "Agenda and actions",
      contentJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Agenda and actions" }] }],
      },
      icon: "🗒️",
    }));
    assert.equal(created.status, 201);
    const template = await body<{ id: string; name: string; title: string; icon: string }>(created);
    assert.equal(template.name, "Meeting notes");
    assert.equal(template.icon, "🗒️");

    const listed = await body<{ id: string; name: string }[]>(await api.pageTemplatesList.GET(jsonRequest("/api/page-templates", "GET")));
    assert.ok(listed.some((row) => row.id === template.id));
    const names = listed.map((row) => row.name);
    assert.deepEqual(names, [...names].sort((left, right) => left.localeCompare(right)), "templates come back sorted by name");

    assert.equal(
      (await api.pageTemplatesList.POST(jsonRequest("/api/page-templates", "POST", { name: "   " }))).status,
      400,
      "a template needs a name",
    );

    const deleted = await api.pageTemplate.DELETE(
      jsonRequest(`/api/page-templates/${template.id}`, "DELETE"),
      routeContext({ id: template.id }),
    );
    assert.equal(deleted.status, 200);
    assert.deepEqual(await body(deleted), { success: true });

    assert.equal(
      (await api.pageTemplate.DELETE(
        jsonRequest(`/api/page-templates/${template.id}`, "DELETE"),
        routeContext({ id: template.id }),
      )).status,
      404,
    );
    assert.equal(
      (await api.pageTemplate.DELETE(jsonRequest("/api/page-templates/nope", "DELETE"), routeContext({ id: "nope" }))).status,
      400,
    );
  });

  it("snapshots a page and creates an independent page from the template", async () => {
    const source = await createPage({
      title: "Kickoff source",
      content: "Goal: ship",
      contentJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Goal: ship" }] }],
      },
      icon: "🚀",
    });

    const createdTemplate = await api.pageTemplatesList.POST(jsonRequest("/api/page-templates", "POST", {
      name: "Kickoff",
      pageId: source.id,
    }));
    assert.equal(createdTemplate.status, 201);
    const template = await body<{ id: string; title: string; content: string; icon: string }>(createdTemplate);
    assert.equal(template.title, "Kickoff source");
    assert.equal(template.content, "Goal: ship");
    assert.equal(template.icon, "🚀");

    const fromTemplate = await api.pages.POST(jsonRequest("/api/pages", "POST", { templateId: template.id }));
    assert.equal(fromTemplate.status, 201);
    const page = await body<PageRow & { icon: string | null }>(fromTemplate);
    assert.notEqual(page.id, source.id);
    assert.equal(page.title, "Kickoff source");
    assert.equal(page.content, "Goal: ship");
    assert.equal(page.icon, "🚀");

    const createdPage = await body<{ contentJson: { type?: string } }>(
      await api.page.GET(jsonRequest(`/api/pages/${page.id}`, "GET"), routeContext({ id: page.id })),
    );
    assert.equal(createdPage.contentJson.type, "doc", "the template document is copied, not referenced");

    // Editing the page must not rewrite the snapshot it came from.
    await api.page.PATCH(
      jsonRequest(`/api/pages/${page.id}`, "PATCH", { content: "Changed after creation" }),
      routeContext({ id: page.id }),
    );
    const listed = await body<{ id: string; content: string }[]>(await api.pageTemplatesList.GET(jsonRequest("/api/page-templates", "GET")));
    assert.equal(listed.find((row) => row.id === template.id)?.content, "Goal: ship");

    assert.equal(
      (await api.pages.POST(jsonRequest("/api/pages", "POST", { templateId: MISSING_ID }))).status,
      404,
      "an unknown template cannot seed a page",
    );
    assert.equal(
      (await api.pageTemplatesList.POST(jsonRequest("/api/page-templates", "POST", { name: "Gone", pageId: MISSING_ID }))).status,
      404,
    );
  });
});

describe("database lifecycle API", () => {
  it("creates a database with a default view and cascades its records on delete", async () => {
    const database = await createDatabase("Lifecycle database");
    const loadedResponse = await api.database.GET(
      jsonRequest(`/api/databases/${database.id}`, "GET"),
      routeContext({ id: database.id }),
    );
    assert.equal(loadedResponse.status, 200);
    const loaded = await body<{ views: { name: string; type: string }[] }>(loadedResponse);
    assert.equal(loaded.views.length, 1);
    assert.equal(loaded.views[0]?.name, "All records");
    assert.equal(loaded.views[0]?.type, "table");

    const record = await createDatabaseRecord(database.id, { title: "Cascade record" });
    const deleted = await api.database.DELETE(
      jsonRequest(`/api/databases/${database.id}`, "DELETE"),
      routeContext({ id: database.id }),
    );
    assert.equal(deleted.status, 200);
    assert.deepEqual(await body(deleted), { success: true });
    assert.equal(
      (await api.database.GET(jsonRequest(`/api/databases/${database.id}`, "GET"), routeContext({ id: database.id }))).status,
      404,
    );
    assert.equal(
      (await api.record.GET(
        jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "GET"),
        routeContext({ id: database.id, recordId: record.id }),
      )).status,
      404,
      "deleting a database removes its records",
    );
  });

  it("rejects invalid database creation and unknown database mutations", async () => {
    assert.equal(
      (await api.databases.POST(jsonRequest("/api/databases", "POST", { name: "   " }))).status,
      400,
    );
    assert.equal(
      (await api.database.GET(jsonRequest("/api/databases/nope", "GET"), routeContext({ id: "nope" }))).status,
      400,
    );
    assert.equal(
      (await api.database.GET(jsonRequest(`/api/databases/${MISSING_ID}`, "GET"), routeContext({ id: MISSING_ID }))).status,
      404,
    );
    assert.equal(
      (await api.database.DELETE(jsonRequest(`/api/databases/${MISSING_ID}`, "DELETE"), routeContext({ id: MISSING_ID }))).status,
      404,
    );
  });
});

describe("database records API", () => {
  it("creates, reads, updates, and deletes a record with its page", async () => {
    const database = await createDatabase("Record CRUD database");
    const score = await createDatabaseProperty(database.id, { name: "Score", type: "number" });
    const notes = await createDatabaseProperty(database.id, { name: "Notes", type: "text" });
    const record = await createDatabaseRecord(database.id, { title: "First record" });

    assert.equal(record.title, "First record");
    assert.ok(record.pageId);
    assert.deepEqual(record.values, {});
    assert.deepEqual(record.relations, {});

    const fetchedResponse = await api.record.GET(
      jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "GET"),
      routeContext({ id: database.id, recordId: record.id }),
    );
    assert.equal(fetchedResponse.status, 200);
    const fetched = await body<{
      pageId: string;
      properties: { id: string }[];
      relations: Record<string, string[]>;
      database: { name: string };
    }>(fetchedResponse);
    assert.equal(fetched.pageId, record.pageId);
    assert.equal(fetched.database.name, "Record CRUD database");
    assert.deepEqual(fetched.properties.map((property) => property.id).sort(), [notes.id, score.id].sort());
    assert.deepEqual(fetched.relations, {});

    const updatedResponse = await api.record.PATCH(
      jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "PATCH", {
        title: "Revised record",
        values: { [score.id]: 42, [notes.id]: "Ready" },
      }),
      routeContext({ id: database.id, recordId: record.id }),
    );
    assert.equal(updatedResponse.status, 200);
    const updated = await body<{ title: string; values: Record<string, unknown> }>(updatedResponse);
    assert.equal(updated.title, "Revised record");
    assert.deepEqual(updated.values, { [score.id]: 42, [notes.id]: "Ready" });

    const pageResponse = await api.page.GET(
      jsonRequest(`/api/pages/${record.pageId}`, "GET"),
      routeContext({ id: record.pageId }),
    );
    assert.equal(pageResponse.status, 200);
    assert.equal((await body<{ title: string }>(pageResponse)).title, "Revised record", "the record page follows the title");

    const invalidValue = await api.record.PATCH(
      jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "PATCH", {
        values: { [score.id]: "not a number" },
      }),
      routeContext({ id: database.id, recordId: record.id }),
    );
    assert.equal(invalidValue.status, 400);
    assert.match(String((await body(invalidValue)).error), /finite number/);

    const other = await createDatabase("Record CRUD other");
    assert.equal(
      (await api.record.PATCH(
        jsonRequest(`/api/databases/${other.id}/records/${record.id}`, "PATCH", { title: "Wrong database" }),
        routeContext({ id: other.id, recordId: record.id }),
      )).status,
      404,
    );

    const deleted = await api.record.DELETE(
      jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "DELETE"),
      routeContext({ id: database.id, recordId: record.id }),
    );
    assert.equal(deleted.status, 200);
    assert.deepEqual(await body(deleted), { success: true });
    assert.equal(
      (await api.record.GET(
        jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "GET"),
        routeContext({ id: database.id, recordId: record.id }),
      )).status,
      404,
    );
    assert.equal(
      (await api.record.DELETE(
        jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "DELETE"),
        routeContext({ id: database.id, recordId: record.id }),
      )).status,
      404,
    );
  });

  it("repairs a record whose linked page was removed", async () => {
    const database = await createDatabase("Legacy record database");
    const record = await createDatabaseRecord(database.id, { title: "Legacy record" });
    const originalPageId = record.pageId;
    await db.update(databaseRecordTable)
      .set({ pageId: null })
      .where(eq(databaseRecordTable.id, record.id));

    const response = await api.record.GET(
      jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "GET"),
      routeContext({ id: database.id, recordId: record.id }),
    );
    assert.equal(response.status, 200);
    const repaired = await body<{ pageId: string }>(response);
    assert.ok(repaired.pageId);
    assert.notEqual(repaired.pageId, originalPageId);
    assert.equal(
      (await api.page.GET(jsonRequest(`/api/pages/${repaired.pageId}`, "GET"), routeContext({ id: repaired.pageId }))).status,
      200,
    );
  });

  it("creates records from database templates and rejects foreign templates", async () => {
    const owner = await createDatabase("Record template owner");
    const other = await createDatabase("Record template other");
    const templateResponse = await api.templates.POST(
      jsonRequest(`/api/databases/${owner.id}/templates`, "POST", {
        name: "Record starter",
        title: "From template",
        values: {},
      }),
      routeContext({ id: owner.id }),
    );
    assert.equal(templateResponse.status, 201);
    const template = await body<{ id: string }>(templateResponse);

    const created = await createDatabaseRecord(owner.id, { templateId: template.id });
    assert.equal(created.title, "From template");
    assert.deepEqual(created.values, {});

    assert.equal(
      (await api.records.POST(
        jsonRequest(`/api/databases/${other.id}/records`, "POST", { templateId: template.id }),
        routeContext({ id: other.id }),
      )).status,
      404,
      "a template only seeds records in its own database",
    );
  });

  it("stores relation targets and rejects foreign or malformed relations", async () => {
    const owner = await createDatabase("Relation owner");
    const target = await createDatabase("Relation target");
    const stranger = await createDatabase("Relation stranger");
    const relation = await createDatabaseProperty(owner.id, {
      name: "Related",
      type: "relation",
      options: { relatedDatabaseId: target.id },
    });
    const targetRecord = await createDatabaseRecord(target.id, { title: "Valid target" });
    const strangerRecord = await createDatabaseRecord(stranger.id, { title: "Foreign target" });
    const source = await createDatabaseRecord(owner.id, { title: "Relation source" });

    const assignedResponse = await api.record.PATCH(
      jsonRequest(`/api/databases/${owner.id}/records/${source.id}`, "PATCH", {
        relations: { [relation.id]: [targetRecord.id] },
      }),
      routeContext({ id: owner.id, recordId: source.id }),
    );
    assert.equal(assignedResponse.status, 200);
    const assigned = await body<{ relations: Record<string, string[]> }>(assignedResponse);
    assert.deepEqual(assigned.relations[relation.id], [targetRecord.id]);

    const loaded = await body<{ records: { id: string; relations: Record<string, string[]> }[] }>(
      await api.database.GET(jsonRequest(`/api/databases/${owner.id}`, "GET"), routeContext({ id: owner.id })),
    );
    assert.deepEqual(loaded.records.find((record) => record.id === source.id)?.relations[relation.id], [targetRecord.id]);

    assert.equal(
      (await api.record.PATCH(
        jsonRequest(`/api/databases/${owner.id}/records/${source.id}`, "PATCH", {
          relations: { [relation.id]: [strangerRecord.id] },
        }),
        routeContext({ id: owner.id, recordId: source.id }),
      )).status,
      400,
      "a relation cannot point at another database",
    );
    assert.equal(
      (await api.record.PATCH(
        jsonRequest(`/api/databases/${owner.id}/records/${source.id}`, "PATCH", {
          relations: { [MISSING_ID]: [] },
        }),
        routeContext({ id: owner.id, recordId: source.id }),
      )).status,
      400,
      "a relation property must belong to the database",
    );

    const clearedResponse = await api.record.PATCH(
      jsonRequest(`/api/databases/${owner.id}/records/${source.id}`, "PATCH", {
        relations: { [relation.id]: [] },
      }),
      routeContext({ id: owner.id, recordId: source.id }),
    );
    assert.equal(clearedResponse.status, 200);
    const cleared = await body<{ relations: Record<string, string[]> }>(clearedResponse);
    assert.deepEqual(cleared.relations[relation.id] ?? [], []);
  });
});

describe("database view mutations API", () => {
  it("renames and reconfigures a view and rejects invalid or foreign updates", async () => {
    const database = await createDatabase("View mutation database");
    const other = await createDatabase("View mutation other");
    const createdResponse = await api.views.POST(
      jsonRequest(`/api/databases/${database.id}/views`, "POST", {
        name: "Board",
        type: "board",
        config: { groupBy: "status" },
      }),
      routeContext({ id: database.id }),
    );
    assert.equal(createdResponse.status, 201);
    const created = await body<{ id: string }>(createdResponse);

    const updatedResponse = await api.view.PATCH(
      jsonRequest(`/api/databases/${database.id}/views/${created.id}`, "PATCH", {
        name: "Pipeline",
        config: { groupBy: "stage" },
      }),
      routeContext({ id: database.id, viewId: created.id }),
    );
    assert.equal(updatedResponse.status, 200);
    const updated = await body<{ name: string; config: Record<string, unknown> }>(updatedResponse);
    assert.equal(updated.name, "Pipeline");
    assert.deepEqual(updated.config, { groupBy: "stage" });

    const loaded = await body<{ views: { id: string; name: string }[] }>(
      await api.database.GET(jsonRequest(`/api/databases/${database.id}`, "GET"), routeContext({ id: database.id })),
    );
    assert.equal(loaded.views.find((view) => view.id === created.id)?.name, "Pipeline");

    assert.equal(
      (await api.view.PATCH(
        jsonRequest(`/api/databases/${other.id}/views/${created.id}`, "PATCH", { name: "Foreign" }),
        routeContext({ id: other.id, viewId: created.id }),
      )).status,
      404,
    );
    assert.equal(
      (await api.view.PATCH(
        jsonRequest(`/api/databases/${database.id}/views/${created.id}`, "PATCH", { name: "   " }),
        routeContext({ id: database.id, viewId: created.id }),
      )).status,
      400,
    );
    assert.equal(
      (await api.views.POST(
        jsonRequest(`/api/databases/${database.id}/views`, "POST", { name: "Timeline", type: "timeline" }),
        routeContext({ id: database.id }),
      )).status,
      400,
    );
  });
});

describe("dashboard API", () => {
  it("returns requested widgets with capped previews and totals", async () => {
    const database = await createDatabase("Dashboard database");
    for (let index = 0; index < 7; index += 1) {
      await createDatabaseRecord(database.id, { title: `Widget record ${index}` });
    }
    const viewResponse = await api.views.POST(
      jsonRequest(`/api/databases/${database.id}/views`, "POST", { name: "Pinned view", type: "gallery" }),
      routeContext({ id: database.id }),
    );
    assert.equal(viewResponse.status, 201);
    const view = await body<{ id: string }>(viewResponse);

    const response = await api.dashboard.GET(
      new Request(`http://localhost/api/dashboard?viewIds=${view.id}`),
    );
    assert.equal(response.status, 200);
    const data = await body<{
      views: { id: string; databaseName: string }[];
      widgets: {
        view: { id: string; databaseName: string };
        records: { id: string }[];
        total: number;
      }[];
    }>(response);
    assert.ok(data.views.some((candidate) => candidate.id === view.id));
    const widget = data.widgets.find((candidate) => candidate.view.id === view.id);
    assert.ok(widget);
    assert.equal(widget.view.databaseName, "Dashboard database");
    assert.equal(widget.total, 7);
    assert.equal(widget.records.length, 5, "dashboard previews are capped at five records");

    const empty = await body<{ views: { id: string }[]; widgets: unknown[] }>(
      await api.dashboard.GET(new Request("http://localhost/api/dashboard")),
    );
    assert.deepEqual(empty.widgets, []);
    assert.ok(empty.views.some((candidate) => candidate.id === view.id));

    const unknown = await body<{ widgets: unknown[] }>(
      await api.dashboard.GET(new Request(`http://localhost/api/dashboard?viewIds=${MISSING_ID}`)),
    );
    assert.deepEqual(unknown.widgets, []);
  });

  it("applies saved filters to dashboard widgets", async () => {
    const database = await createDatabase("Dashboard filter database");
    const score = await createDatabaseProperty(database.id, { name: "Score", type: "number" });
    for (const [title, value] of [["Low", 10], ["Medium", 20], ["High", 30]] as const) {
      const record = await createDatabaseRecord(database.id, { title });
      const updated = await api.record.PATCH(
        jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "PATCH", {
          values: { [score.id]: value },
        }),
        routeContext({ id: database.id, recordId: record.id }),
      );
      assert.equal(updated.status, 200);
    }
    const viewResponse = await api.views.POST(
      jsonRequest(`/api/databases/${database.id}/views`, "POST", {
        name: "High scores",
        type: "table",
        config: {
          filters: [{ id: "score", propertyId: score.id, operator: "greater_than", value: "15" }],
        },
      }),
      routeContext({ id: database.id }),
    );
    assert.equal(viewResponse.status, 201);
    const view = await body<{ id: string }>(viewResponse);

    const response = await api.dashboard.GET(
      new Request(`http://localhost/api/dashboard?viewIds=${view.id}`),
    );
    const data = await body<{
      widgets: {
        view: { id: string };
        records: { values: Record<string, unknown> }[];
        total: number;
      }[];
    }>(response);
    const widget = data.widgets.find((candidate) => candidate.view.id === view.id);
    assert.ok(widget);
    assert.equal(widget.total, 2);
    assert.deepEqual(
      widget.records.map((record) => record.values[score.id]).sort((left, right) => Number(left) - Number(right)),
      [20, 30],
    );
  });
});

describe("search API", () => {
  it("handles empty and oversized queries", async () => {
    assert.deepEqual(
      await body(await api.search.GET(new Request("http://localhost/api/search"))),
      { pages: [], records: [] },
    );
    assert.equal(
      (await api.search.GET(new Request(`http://localhost/api/search?q=${"x".repeat(201)}`))).status,
      400,
    );
  });

  it("searches pages and record values while excluding trashed pages", async () => {
    const token = "NebulaSearchToken";
    const page = await createPage({ title: `${token} page`, content: `${token} content` });
    const trashed = await createPage({ title: `${token} trashed` });
    await api.page.DELETE(
      jsonRequest(`/api/pages/${trashed.id}`, "DELETE"),
      routeContext({ id: trashed.id }),
    );
    const database = await createDatabase(`${token} database`);
    const notes = await createDatabaseProperty(database.id, { name: "Notes", type: "text" });
    const record = await createDatabaseRecord(database.id, {
      title: `${token} record`,
      values: { [notes.id]: `${token} value` },
    });

    const response = await api.search.GET(
      new Request(`http://localhost/api/search?q=${encodeURIComponent(token)}`),
    );
    assert.equal(response.status, 200);
    const results = await body<{
      pages: { id: string; title: string }[];
      records: { id: string; title: string; databaseName: string }[];
    }>(response);
    assert.ok(results.pages.some((result) => result.id === page.id));
    assert.ok(!results.pages.some((result) => result.id === trashed.id));
    assert.ok(results.records.some((result) => result.id === record.id && result.databaseName === `${token} database`));
  });
});

describe("export API", () => {
  it("returns a complete workspace snapshot with safe headers", async () => {
    const page = await createPage({ title: "Export snapshot page", content: "Export body" });
    const database = await createDatabase("Export snapshot database");
    const response = await api.exportWorkspace.GET(jsonRequest("/api/export", "GET"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(
      response.headers.get("content-disposition") ?? "",
      /^attachment; filename="kbs-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );

    const payload = await body<{
      format: string;
      version: number;
      exportedAt: string;
      counts: Record<string, number>;
      pages: { id: string }[];
      databases: { id: string }[];
      attachments: { id: string; url: string }[];
      attachmentsNote: string;
    }>(response);
    assert.equal(payload.format, "kbs-export");
    assert.equal(payload.version, 1);
    assert.ok(!Number.isNaN(Date.parse(payload.exportedAt)));
    assert.ok(payload.counts.pages >= 1);
    assert.ok(payload.pages.some((candidate) => candidate.id === page.id));
    assert.ok(payload.databases.some((candidate) => candidate.id === database.id));
    assert.match(payload.attachmentsNote, /bytes/i);
    for (const attachment of payload.attachments) {
      assert.equal(attachment.url, `/api/attachments/${attachment.id}`);
    }
  });
});

describe("page browser API", () => {
  it("separates regular, inbox, record, and favorite pages", async () => {
    const token = "PageBrowserScopeToken";
    const regular = await createPage({ title: `${token} regular` });
    const favorite = await createPage({ title: `${token} favorite` });
    await api.page.PATCH(
      jsonRequest(`/api/pages/${favorite.id}`, "PATCH", { isFavorite: true }),
      routeContext({ id: favorite.id }),
    );
    const inbox = await body<PageRow>(await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
      title: `${token} inbox`,
      content: "Inbox body",
    })));
    const database = await createDatabase(`${token} database`);
    const record = await createDatabaseRecord(database.id, { title: `${token} record` });
    const base = `/api/pages?q=${encodeURIComponent(token)}`;

    const defaultPages = await body<PageRow[]>(await api.pages.GET(jsonRequest(base, "GET")));
    assert.ok(defaultPages.some((page) => page.id === regular.id));
    assert.ok(defaultPages.some((page) => page.id === favorite.id));
    assert.ok(!defaultPages.some((page) => page.id === inbox.id));
    assert.ok(!defaultPages.some((page) => page.id === record.pageId));

    const favorites = await body<PageRow[]>(await api.pages.GET(jsonRequest(`${base}&favorite=true`, "GET")));
    assert.deepEqual(favorites.map((page) => page.id), [favorite.id]);

    const withInbox = await body<PageRow[]>(await api.pages.GET(jsonRequest(`${base}&includeInbox=true`, "GET")));
    assert.ok(withInbox.some((page) => page.id === inbox.id));
    assert.ok(!withInbox.some((page) => page.id === record.pageId));

    const withRecordPages = await body<PageRow[]>(await api.pages.GET(jsonRequest(`${base}&includeRecordPages=true`, "GET")));
    assert.ok(withRecordPages.some((page) => page.id === record.pageId));
    assert.ok(!withRecordPages.some((page) => page.id === inbox.id));
  });

  it("rejects malformed tag filters", async () => {
    assert.equal(
      (await api.pages.GET(jsonRequest("/api/pages?tagId=nope", "GET"))).status,
      400,
    );
  });
});

describe("trash API", () => {
  it("lists a trashed subtree and restores it together", async () => {
    const parent = await createPage({ title: "Trash parent" });
    const child = await createPage({ title: "Trash child", parentId: parent.id });
    const deleted = await api.page.DELETE(
      jsonRequest(`/api/pages/${parent.id}`, "DELETE"),
      routeContext({ id: parent.id }),
    );
    assert.equal(deleted.status, 200);
    assert.deepEqual(await body(deleted), { success: true, trashedCount: 2 });

    const trash = await body<{
      items: { id: string; descendantCount: number }[];
      totalTrashed: number;
    }>(await api.trash.GET(jsonRequest("/api/trash", "GET")));
    const root = trash.items.find((item) => item.id === parent.id);
    assert.ok(root);
    assert.equal(root.descendantCount, 1);
    assert.ok(trash.totalTrashed >= 2);
    assert.ok(!trash.items.some((item) => item.id === child.id), "children are listed under their trashed root");

    const restored = await api.trashRestore.POST(
      jsonRequest(`/api/trash/${parent.id}/restore`, "POST"),
      routeContext({ id: parent.id }),
    );
    assert.equal(restored.status, 200);
    assert.deepEqual(await body(restored), { success: true, restoredCount: 2 });
    assert.equal(
      (await api.page.GET(jsonRequest(`/api/pages/${parent.id}`, "GET"), routeContext({ id: parent.id }))).status,
      200,
    );
    assert.equal(
      (await api.page.GET(jsonRequest(`/api/pages/${child.id}`, "GET"), routeContext({ id: child.id }))).status,
      200,
    );
  });

  it("purges only trashed pages and reports counts", async () => {
    const page = await createPage({ title: "Purge me" });
    assert.equal(
      (await api.trashItem.DELETE(
        jsonRequest(`/api/trash/${page.id}`, "DELETE"),
        routeContext({ id: page.id }),
      )).status,
      404,
      "active pages cannot be purged",
    );

    await api.page.DELETE(
      jsonRequest(`/api/pages/${page.id}`, "DELETE"),
      routeContext({ id: page.id }),
    );
    const purged = await api.trashItem.DELETE(
      jsonRequest(`/api/trash/${page.id}`, "DELETE"),
      routeContext({ id: page.id }),
    );
    assert.equal(purged.status, 200);
    assert.deepEqual(await body(purged), {
      success: true,
      deletedCount: 1,
      attachmentsRemoved: 0,
      bytesFreed: 0,
    });
    assert.equal(
      (await api.page.GET(jsonRequest(`/api/pages/${page.id}`, "GET"), routeContext({ id: page.id }))).status,
      404,
    );
    assert.equal(
      (await api.trashItem.DELETE(
        jsonRequest(`/api/trash/${page.id}`, "DELETE"),
        routeContext({ id: page.id }),
      )).status,
      404,
    );
    assert.equal(
      (await api.trashItem.DELETE(jsonRequest("/api/trash/nope", "DELETE"), routeContext({ id: "nope" }))).status,
      400,
    );
  });
});
