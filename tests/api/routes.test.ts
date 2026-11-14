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
  related: typeof import("../../src/app/api/pages/[id]/related/route");
  focus: typeof import("../../src/app/api/pages/[id]/focus/route");
  focusPinned: typeof import("../../src/app/api/focus/pinned/route");
  taskCompletions: typeof import("../../src/app/api/pages/[id]/task-completions/route");
  pageRecords: typeof import("../../src/app/api/pages/[id]/records/route");
  recordPages: typeof import("../../src/app/api/records/[recordId]/pages/route");
  connections: typeof import("../../src/app/api/orphans/route");
  tags: typeof import("../../src/app/api/tags/route");
  savedSearches: typeof import("../../src/app/api/saved-searches/route");
  savedSearch: typeof import("../../src/app/api/saved-searches/[id]/route");
  reading: typeof import("../../src/app/api/reading/route");
  readingItem: typeof import("../../src/app/api/reading/[id]/route");
  readingHighlights: typeof import("../../src/app/api/reading/[id]/highlights/route");
  readingHighlight: typeof import("../../src/app/api/reading/[id]/highlights/[highlightId]/route");
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
  propertyUpdate: typeof import("../../src/app/api/databases/[id]/properties/[propertyId]/route");
  views: typeof import("../../src/app/api/databases/[id]/views/route");
  view: typeof import("../../src/app/api/databases/[id]/views/[viewId]/route");
  viewUsage: typeof import("../../src/app/api/databases/[id]/views/[viewId]/usage/route");
  viewReorder: typeof import("../../src/app/api/databases/[id]/views/reorder/route");
  templates: typeof import("../../src/app/api/databases/[id]/templates/route");
  template: typeof import("../../src/app/api/databases/[id]/templates/[templateId]/route");
  pageTemplatesList: typeof import("../../src/app/api/page-templates/route");
  pageTemplate: typeof import("../../src/app/api/page-templates/[id]/route");
  record: typeof import("../../src/app/api/databases/[id]/records/[recordId]/route");
  button: typeof import("../../src/app/api/databases/[id]/records/[recordId]/button/route");
  dashboard: typeof import("../../src/app/api/dashboard/route");
  search: typeof import("../../src/app/api/search/route");
  exportWorkspace: typeof import("../../src/app/api/export/route");
  trash: typeof import("../../src/app/api/trash/route");
  trashItem: typeof import("../../src/app/api/trash/[id]/route");
  trashRestore: typeof import("../../src/app/api/trash/[id]/restore/route");
};

type Json = Record<string, unknown>;
type PageRow = { id: string; title: string; content: string; isInbox: boolean; parentId: string | null; isRecordPage: boolean };
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

function focusDocument(tasks: { text: string; checked: boolean }[]) {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Milestones" }] },
      {
        type: "taskList",
        content: tasks.map((task) => ({
          type: "taskItem",
          attrs: { checked: task.checked },
          content: [{ type: "paragraph", content: [{ type: "text", text: task.text }] }],
        })),
      },
    ],
  };
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
    related,
    tags,
    savedSearches,
    savedSearch,
    reading,
    readingItem,
    readingHighlights,
    readingHighlight,
    graph,
    focus,
    focusPinned,
    taskCompletions,
    records,
    inbox,
    inboxItem,
    attachments,
    attachment,
    orphans,
    databases,
    database,
    properties,
    propertyUpdate,
    views,
    view,
    viewUsage,
    viewReorder,
    templates,
    template,
    pageTemplatesList,
    pageTemplate,
    record,
    button,
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
    import("../../src/app/api/pages/[id]/related/route"),
    import("../../src/app/api/tags/route"),
    import("../../src/app/api/saved-searches/route"),
    import("../../src/app/api/saved-searches/[id]/route"),
    import("../../src/app/api/reading/route"),
    import("../../src/app/api/reading/[id]/route"),
    import("../../src/app/api/reading/[id]/highlights/route"),
    import("../../src/app/api/reading/[id]/highlights/[highlightId]/route"),
    import("../../src/app/api/graph/route"),
    import("../../src/app/api/pages/[id]/focus/route"),
    import("../../src/app/api/focus/pinned/route"),
    import("../../src/app/api/pages/[id]/task-completions/route"),
    import("../../src/app/api/databases/[id]/records/route"),
    import("../../src/app/api/inbox/route"),
    import("../../src/app/api/inbox/[id]/route"),
    import("../../src/app/api/attachments/route"),
    import("../../src/app/api/attachments/[id]/route"),
    import("../../src/app/api/attachments/orphans/route"),
    import("../../src/app/api/databases/route"),
    import("../../src/app/api/databases/[id]/route"),
    import("../../src/app/api/databases/[id]/properties/route"),
    import("../../src/app/api/databases/[id]/properties/[propertyId]/route"),
    import("../../src/app/api/databases/[id]/views/route"),
    import("../../src/app/api/databases/[id]/views/[viewId]/route"),
    import("../../src/app/api/databases/[id]/views/[viewId]/usage/route"),
    import("../../src/app/api/databases/[id]/views/reorder/route"),
    import("../../src/app/api/databases/[id]/templates/route"),
    import("../../src/app/api/databases/[id]/templates/[templateId]/route"),
    import("../../src/app/api/page-templates/route"),
    import("../../src/app/api/page-templates/[id]/route"),
    import("../../src/app/api/databases/[id]/records/[recordId]/route"),
    import("../../src/app/api/databases/[id]/records/[recordId]/button/route"),
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

  api = { pages, page, move, reorder, revisions, pageTags, links, related, tags, savedSearches, savedSearch, reading, readingItem, readingHighlights, readingHighlight, graph, focus, focusPinned, taskCompletions, records, inbox, inboxItem, attachments, attachment, orphans, databases, database, properties, propertyUpdate, views, view, viewUsage, viewReorder, templates, template, pageTemplatesList, pageTemplate, record, button, dashboard, search, exportWorkspace, trash, trashItem, trashRestore, pageRecords, recordPages, connections };
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
      uploadForm(new File([new Uint8Array([1])], "page.html", { type: "text/html" })),
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

  it("stores linked documents and downloads them instead of previewing", async () => {
    const response = await api.attachments.POST(formRequest(
      "/api/attachments",
      uploadForm(new File([new Uint8Array([104, 105])], "notes.txt", { type: "text/plain" })),
    ));
    assert.equal(response.status, 201);
    const attachment = await body<AttachmentRow>(response);

    const download = await api.attachment.GET(
      jsonRequest(attachment.url, "GET"),
      routeContext({ id: attachment.id }),
    );
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "text/plain");
    assert.equal(download.headers.get("content-disposition"), 'attachment; filename="notes.txt"');
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

describe("page cover API", () => {
  it("persists a vertical focal point for the cover", async () => {
    const page = await createPage({ title: "Cover focal point" });

    const initial = await body<{ coverPosition: number }>(
      await api.page.GET(jsonRequest(`/api/pages/${page.id}`, "GET"), routeContext({ id: page.id })),
    );
    assert.equal(initial.coverPosition, 50, "new covers start centered");

    const patched = await api.page.PATCH(
      jsonRequest(`/api/pages/${page.id}`, "PATCH", {
        coverImageUrl: "https://example.com/cover.png",
        coverPosition: 18,
      }),
      routeContext({ id: page.id }),
    );
    assert.equal(patched.status, 200);
    assert.equal((await body<{ coverPosition: number }>(patched)).coverPosition, 18);

    const reloaded = await body<{ coverPosition: number }>(
      await api.page.GET(jsonRequest(`/api/pages/${page.id}`, "GET"), routeContext({ id: page.id })),
    );
    assert.equal(reloaded.coverPosition, 18, "the focal point survives a reload");

    for (const invalid of [-1, 101, 12.5, "25"]) {
      const response = await api.page.PATCH(
        jsonRequest(`/api/pages/${page.id}`, "PATCH", { coverPosition: invalid }),
        routeContext({ id: page.id }),
      );
      assert.equal(response.status, 400, `rejects cover position ${String(invalid)}`);
    }
  });
});

describe("inbox API", () => {
  it("requires a title, note, link, or file", async () => {
    const response = await api.inbox.POST(jsonRequest("/api/inbox", "POST", {}));

    assert.equal(response.status, 400);
    assert.equal((await body(response)).error, "Add a title, note, link, or file to capture.");
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

  it("keeps an uploaded PDF with the capture", async () => {
    const upload = await api.attachments.POST(formRequest(
      "/api/attachments",
      uploadForm(new File([new Uint8Array([37, 80, 68, 70])], "syllabus.pdf", { type: "application/pdf" })),
    ));
    assert.equal(upload.status, 201);
    const stored = await body<{ id: string; url: string }>(upload);

    const response = await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
      attachmentId: stored.id,
    }));

    assert.equal(response.status, 201);
    const item = await body<PageRow & {
      captureAttachment: { id: string; url: string; filename: string; mimeType: string; size: number } | null;
      contentJson: { content: { type: string; content?: { text: string; marks?: { type: string; attrs: { href: string } }[] }[] }[] };
    }>(response);
    assert.equal(item.title, "syllabus", "the file name titles the capture");
    assert.equal(item.content, "syllabus.pdf");
    assert.deepEqual(item.captureAttachment, {
      id: stored.id,
      url: stored.url,
      filename: "syllabus.pdf",
      mimeType: "application/pdf",
      size: 4,
    });
    const link = item.contentJson.content[0]?.content?.[0];
    assert.equal(link?.text, "syllabus.pdf");
    assert.equal(link?.marks?.[0]?.attrs.href, stored.url);
  });

  it("rejects an attachment id that was never uploaded", async () => {
    const response = await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
      attachmentId: MISSING_ID,
    }));

    assert.equal(response.status, 400);
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
    assert.equal((await body(response)).error, "Add a title, note, link, or file to capture.");
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

    const tag = await body<{ id: string; name: string }>(
      await api.tags.POST(jsonRequest("/api/tags", "POST", { name: `Graph tag ${Date.now()}` })),
    );
    await api.pageTags.POST(
      jsonRequest(`/api/pages/${child.id}/tags`, "POST", { tagId: tag.id }),
      routeContext({ id: child.id }),
    );

    const graph = await body<{
      nodes: { id: string; parentId: string | null; tags: { id: string; name: string }[] }[];
      edges: { source: string; target: string; type: string }[];
    }>(
      await api.graph.GET(jsonRequest("/api/graph", "GET")),
    );
    assert.ok(graph.nodes.some((node) => node.id === parent.id));
    assert.ok(graph.nodes.some((node) => node.id === child.id));
    assert.equal(
      graph.nodes.find((node) => node.id === child.id)?.parentId,
      parent.id,
      "nodes carry their parent so the graph can scope a page group",
    );
    assert.deepEqual(
      graph.nodes.find((node) => node.id === child.id)?.tags,
      [{ id: tag.id, name: tag.name }],
      "nodes carry their tags so the graph can filter and connect by tag",
    );
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
    assert.equal(nonNumericReference.status, 400, "formulas cannot read a text property");

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

    const chained = await api.properties.POST(
      jsonRequest(`/api/databases/${database.id}/properties`, "POST", {
        name: "Progress twice",
        type: "formula",
        options: { expression: "{Progress} * 2" },
      }),
      context,
    );
    assert.equal(chained.status, 201, "a formula can reference another formula");
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

  it("includes each record's page cover for gallery fallbacks", async () => {
    const database = await createDatabase("Gallery cover database");
    const record = await createDatabaseRecord(database.id, { title: "Covered record" });
    const coverUrl = "https://example.com/gallery-cover.jpg";

    const pagePatch = await api.page.PATCH(
      jsonRequest(`/api/pages/${record.pageId}`, "PATCH", { coverImageUrl: coverUrl }),
      routeContext({ id: record.pageId }),
    );
    assert.equal(pagePatch.status, 200);

    const loadedResponse = await api.database.GET(
      jsonRequest(`/api/databases/${database.id}`, "GET"),
      routeContext({ id: database.id }),
    );
    assert.equal(loadedResponse.status, 200);
    const loaded = await body<{ records: { id: string; pageCoverImageUrl: string | null }[] }>(loadedResponse);
    assert.equal(loaded.records.find((row) => row.id === record.id)?.pageCoverImageUrl, coverUrl);

    // A record edit must not drop the fallback while the gallery keeps the row.
    const updatedResponse = await api.record.PATCH(
      jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "PATCH", { title: "Renamed record" }),
      routeContext({ id: database.id, recordId: record.id }),
    );
    assert.equal(updatedResponse.status, 200);
    assert.equal((await body<{ pageCoverImageUrl: string | null }>(updatedResponse)).pageCoverImageUrl, coverUrl);
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
  it("lists the records whose relations point at a record", async () => {
    const owner = await createDatabase("Reverse relation owner");
    const targetDatabase = await createDatabase("Reverse relation target");
    const relation = await createDatabaseProperty(owner.id, {
      name: "Inspiration",
      type: "relation",
      options: { relatedDatabaseId: targetDatabase.id },
    });
    const source = await createDatabaseRecord(owner.id, { title: "Pointing record" });
    const unrelated = await createDatabaseRecord(owner.id, { title: "Unrelated record" });
    const target = await createDatabaseRecord(targetDatabase.id, { title: "Pointed-at record" });

    const assigned = await api.record.PATCH(
      jsonRequest(`/api/databases/${owner.id}/records/${source.id}`, "PATCH", {
        relations: { [relation.id]: [target.id] },
      }),
      routeContext({ id: owner.id, recordId: source.id }),
    );
    assert.equal(assigned.status, 200);

    const response = await api.record.GET(
      jsonRequest(`/api/databases/${targetDatabase.id}/records/${target.id}`, "GET"),
      routeContext({ id: targetDatabase.id, recordId: target.id }),
    );
    assert.equal(response.status, 200);
    const detail = await body<{
      relations: Record<string, string[]>;
      backlinks: { id: string; title: string; databaseId: string; databaseName: string; properties: string[] }[];
    }>(response);

    assert.deepEqual(detail.relations, {}, "the target record has no outgoing relations");
    assert.deepEqual(detail.backlinks, [{
      id: source.id,
      title: "Pointing record",
      databaseId: owner.id,
      databaseName: "Reverse relation owner",
      properties: ["Inspiration"],
    }]);
    assert.ok(
      !detail.backlinks.some((row) => row.id === unrelated.id),
      "a record that does not point here is left out",
    );

    const cleared = await api.record.PATCH(
      jsonRequest(`/api/databases/${owner.id}/records/${source.id}`, "PATCH", {
        relations: { [relation.id]: [] },
      }),
      routeContext({ id: owner.id, recordId: source.id }),
    );
    assert.equal(cleared.status, 200);
    const afterClearing = await body<{ backlinks: unknown[] }>(await api.record.GET(
      jsonRequest(`/api/databases/${targetDatabase.id}/records/${target.id}`, "GET"),
      routeContext({ id: targetDatabase.id, recordId: target.id }),
    ));
    assert.deepEqual(afterClearing.backlinks, [], "removing the relation removes the reverse link");
  });

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

  it("runs button actions on the record and on linked records, with per-action results", async () => {
    const tasks = await createDatabase("Button tasks");
    const projects = await createDatabase("Button projects");
    const archive = await createDatabase("Button archive");
    const status = await createDatabaseProperty(tasks.id, {
      name: "Status",
      type: "select",
      options: { choices: ["Open", "Done"] },
    });
    const note = await createDatabaseProperty(tasks.id, { name: "Note", type: "text" });
    const projectState = await createDatabaseProperty(projects.id, {
      name: "Project state",
      type: "select",
      options: { choices: ["Active", "Archived"] },
    });
    const project = await createDatabaseProperty(tasks.id, {
      name: "Project",
      type: "relation",
      options: { relatedDatabaseId: projects.id },
    });
    const archiveSummary = await createDatabaseProperty(archive.id, { name: "Summary", type: "text" });
    const firstProject = await createDatabaseRecord(projects.id, { title: "First project" });
    const secondProject = await createDatabaseRecord(projects.id, { title: "Second project" });
    const task = await createDatabaseRecord(tasks.id, { title: "Ship it" });

    const linked = await api.record.PATCH(
      jsonRequest(`/api/databases/${tasks.id}/records/${task.id}`, "PATCH", {
        relations: { [project.id]: [firstProject.id, secondProject.id] },
      }),
      routeContext({ id: tasks.id, recordId: task.id }),
    );
    assert.equal(linked.status, 200);

    const button = await createDatabaseProperty(tasks.id, {
      name: "Complete task",
      type: "button",
      options: {
        actions: [
          { type: "set_property", propertyId: status.id, value: "Done" },
          { type: "set_property", propertyId: note.id, value: "Completed by button" },
          {
            type: "set_related_property",
            relationPropertyId: project.id,
            propertyId: projectState.id,
            value: "Archived",
          },
          {
            type: "create_record",
            databaseId: archive.id,
            title: "Created by button",
            values: { [archiveSummary.id]: "From a task" },
          },
        ],
      },
    });

    const response = await api.button.POST(
      jsonRequest(`/api/databases/${tasks.id}/records/${task.id}/button`, "POST", {
        propertyId: button.id,
      }),
      routeContext({ id: tasks.id, recordId: task.id }),
    );
    assert.equal(response.status, 200);
    const result = await body<{
      record: { values: Record<string, unknown> };
      results: {
        type: string;
        label: string;
        affected: number;
        createdRecordIds?: string[];
      }[];
    }>(response);
    assert.equal(result.record.values[status.id], "Done");
    assert.equal(result.record.values[note.id], "Completed by button");
    assert.deepEqual(result.results.map((entry) => entry.affected), [1, 1, 2, 1]);
    assert.deepEqual(result.results.map((entry) => entry.type), [
      "set_property",
      "set_property",
      "set_related_property",
      "create_record",
    ]);
    const createdId = result.results[3]?.createdRecordIds?.[0];
    assert.ok(createdId, "the create result reports its new record");
    const archiveData = await body<{
      records: { id: string; title: string; pageId: string | null; values: Record<string, unknown> }[];
    }>(await api.database.GET(
      jsonRequest(`/api/databases/${archive.id}`, "GET"),
      routeContext({ id: archive.id }),
    ));
    const createdArchive = archiveData.records.find((entry) => entry.id === createdId);
    assert.equal(createdArchive?.title, "Created by button");
    assert.equal(createdArchive?.values[archiveSummary.id], "From a task");
    assert.ok(createdArchive?.pageId, "a button-created record gets its own page");

    for (const projectRecord of [firstProject, secondProject]) {
      const stored = await body<{ values: Record<string, unknown> }>(await api.record.GET(
        jsonRequest(`/api/databases/${projects.id}/records/${projectRecord.id}`, "GET"),
        routeContext({ id: projects.id, recordId: projectRecord.id }),
      ));
      assert.equal(stored.values[projectState.id], "Archived");
    }

    const withoutLinks = await createDatabaseRecord(tasks.id, { title: "No project" });
    const noLinks = await api.button.POST(
      jsonRequest(`/api/databases/${tasks.id}/records/${withoutLinks.id}/button`, "POST", {
        propertyId: button.id,
      }),
      routeContext({ id: tasks.id, recordId: withoutLinks.id }),
    );
    assert.equal(noLinks.status, 200);
    const noLinkResult = await body<{ results: { affected: number }[] }>(noLinks);
    assert.equal(noLinkResult.results[2]?.affected, 0, "an empty relation reports no linked records");
    assert.equal(noLinkResult.results[3]?.affected, 1, "create still runs on a record with no links");
  });

  it("applies one increment per click when clicks arrive together", async () => {
    const database = await createDatabase("Button counters");
    const count = await createDatabaseProperty(database.id, { name: "Count", type: "number" });
    const record = await createDatabaseRecord(database.id, { title: "Counter" });
    const button = await createDatabaseProperty(database.id, {
      name: "Raise count",
      type: "button",
      options: {
        actions: [{ type: "set_property", propertyId: count.id, value: { expression: "{Count} + 1" } }],
      },
    });

    const seeded = await api.record.PATCH(
      jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "PATCH", {
        values: { [count.id]: 4 },
      }),
      routeContext({ id: database.id, recordId: record.id }),
    );
    assert.equal(seeded.status, 200);

    const clicks = Array.from({ length: 5 }, () => api.button.POST(
      jsonRequest(`/api/databases/${database.id}/records/${record.id}/button`, "POST", {
        propertyId: button.id,
      }),
      routeContext({ id: database.id, recordId: record.id }),
    ));
    const responses = await Promise.all(clicks);
    assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 200, 200]);

    const stored = await body<{ values: Record<string, unknown> }>(await api.record.GET(
      jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "GET"),
      routeContext({ id: database.id, recordId: record.id }),
    ));
    assert.equal(stored.values[count.id], 9, "every click applied its own increment");
  });

  it("updates saved button actions and rejects invalid edits", async () => {
    const database = await createDatabase("Button editing");
    const other = await createDatabase("Button editing other");
    const status = await createDatabaseProperty(database.id, {
      name: "Status",
      type: "select",
      options: { choices: ["Open", "Done"] },
    });
    const foreign = await createDatabaseProperty(other.id, { name: "Foreign", type: "text" });
    const button = await createDatabaseProperty(database.id, {
      name: "Finish",
      type: "button",
      options: { actions: [{ type: "set_property", propertyId: status.id, value: "Open" }] },
    });
    const context = routeContext({ id: database.id, propertyId: button.id });

    const updated = await api.propertyUpdate.PATCH(
      jsonRequest(`/api/databases/${database.id}/properties/${button.id}`, "PATCH", {
        actions: [{ type: "set_property", propertyId: status.id, value: "Done" }],
      }),
      context,
    );
    assert.equal(updated.status, 200);
    const updatedProperty = await body<{ id: string; options: { actions: { value: string }[] } }>(updated);
    assert.equal(updatedProperty.id, button.id);
    assert.equal(updatedProperty.options.actions[0]?.value, "Done");

    const record = await createDatabaseRecord(database.id, { title: "Edited button target" });
    const run = await api.button.POST(
      jsonRequest(`/api/databases/${database.id}/records/${record.id}/button`, "POST", { propertyId: button.id }),
      routeContext({ id: database.id, recordId: record.id }),
    );
    assert.equal(run.status, 200);
    assert.equal((await body<{ record: { values: Record<string, unknown> } }>(run)).record.values[status.id], "Done");

    assert.equal((await api.propertyUpdate.PATCH(
      jsonRequest(`/api/databases/${database.id}/properties/${button.id}`, "PATCH", {
        actions: [{ type: "set_property", propertyId: foreign.id, value: "x" }],
      }),
      context,
    )).status, 400, "edits cannot target another database");
    assert.equal((await api.propertyUpdate.PATCH(
      jsonRequest(`/api/databases/${database.id}/properties/${status.id}`, "PATCH", {
        actions: [{ type: "set_property", propertyId: status.id, value: "Done" }],
      }),
      routeContext({ id: database.id, propertyId: status.id }),
    )).status, 400, "only button properties have actions");
    assert.equal((await api.propertyUpdate.PATCH(
      jsonRequest(`/api/databases/${database.id}/properties/${MISSING_ID}`, "PATCH", { actions: [] }),
      routeContext({ id: database.id, propertyId: MISSING_ID }),
    )).status, 400, "malformed action lists are rejected");
    assert.equal((await api.propertyUpdate.PATCH(
      jsonRequest(`/api/databases/${database.id}/properties/${MISSING_ID}`, "PATCH", {
        actions: [{ type: "set_property", propertyId: status.id, value: "Done" }],
      }),
      routeContext({ id: database.id, propertyId: MISSING_ID }),
    )).status, 404);
  });

  it("updates an existing record chosen by the user and rejects mismatched targets", async () => {
    const source = await createDatabase("Button existing source");
    const target = await createDatabase("Button existing target");
    const summary = await createDatabaseProperty(target.id, { name: "Summary", type: "text" });
    const note = await createDatabaseProperty(source.id, { name: "Note", type: "text" });
    const sourceRecord = await createDatabaseRecord(source.id, { title: "Source record" });
    const targetRecord = await createDatabaseRecord(target.id, { title: "Chosen record" });
    const button = await createDatabaseProperty(source.id, {
      name: "Update chosen record",
      type: "button",
      options: {
        actions: [
          {
            type: "set_record_property",
            databaseId: target.id,
            recordId: targetRecord.id,
            propertyId: summary.id,
            value: "Updated target",
          },
          {
            type: "set_record_property",
            databaseId: source.id,
            recordId: sourceRecord.id,
            propertyId: note.id,
            value: "Updated itself",
          },
        ],
      },
    });

    const run = await api.button.POST(
      jsonRequest(`/api/databases/${source.id}/records/${sourceRecord.id}/button`, "POST", {
        propertyId: button.id,
      }),
      routeContext({ id: source.id, recordId: sourceRecord.id }),
    );
    assert.equal(run.status, 200);
    const result = await body<{
      record: { values: Record<string, unknown> };
      results: { type: string; label: string; affected: number }[];
    }>(run);
    assert.deepEqual(result.results.map((entry) => entry.type), ["set_record_property", "set_record_property"]);
    assert.deepEqual(result.results.map((entry) => entry.affected), [1, 1]);
    assert.equal(result.results[0]?.label, "Summary");
    assert.equal(result.record.values[note.id], "Updated itself", "the action can target the record that owns the button");

    const storedTarget = await body<{ values: Record<string, unknown> }>(await api.record.GET(
      jsonRequest(`/api/databases/${target.id}/records/${targetRecord.id}`, "GET"),
      routeContext({ id: target.id, recordId: targetRecord.id }),
    ));
    assert.equal(storedTarget.values[summary.id], "Updated target");

    const mismatchedRecord = await api.properties.POST(
      jsonRequest(`/api/databases/${source.id}/properties`, "POST", {
        name: "Wrong record",
        type: "button",
        options: { actions: [{
          type: "set_record_property",
          databaseId: target.id,
          recordId: sourceRecord.id,
          propertyId: summary.id,
          value: "x",
        }] },
      }),
      routeContext({ id: source.id }),
    );
    assert.equal(mismatchedRecord.status, 400, "the record must belong to the chosen database");

    const missingRecord = await api.properties.POST(
      jsonRequest(`/api/databases/${source.id}/properties`, "POST", {
        name: "Missing record",
        type: "button",
        options: { actions: [{
          type: "set_record_property",
          databaseId: target.id,
          recordId: MISSING_ID,
          propertyId: summary.id,
          value: "x",
        }] },
      }),
      routeContext({ id: source.id }),
    );
    assert.equal(missingRecord.status, 400, "the chosen record must still exist");

    const wrongProperty = await api.properties.POST(
      jsonRequest(`/api/databases/${source.id}/properties`, "POST", {
        name: "Wrong property",
        type: "button",
        options: { actions: [{
          type: "set_record_property",
          databaseId: target.id,
          recordId: targetRecord.id,
          propertyId: note.id,
          value: "x",
        }] },
      }),
      routeContext({ id: source.id }),
    );
    assert.equal(wrongProperty.status, 400, "the property must belong to the chosen database");
  });

  it("rejects button actions that target foreign, calculated, or invalid values", async () => {
    const database = await createDatabase("Button validation");
    const other = await createDatabase("Button validation other");
    const foreign = await createDatabaseProperty(other.id, { name: "Foreign", type: "text" });
    const choice = await createDatabaseProperty(database.id, {
      name: "Choice",
      type: "select",
      options: { choices: ["One", "Two"] },
    });
    const formula = await createDatabaseProperty(database.id, {
      name: "Calculated",
      type: "formula",
      options: { expression: "1" },
    });
    const relation = await createDatabaseProperty(database.id, {
      name: "Foreign relation",
      type: "relation",
      options: { relatedDatabaseId: other.id },
    });
    const otherState = await createDatabaseProperty(other.id, {
      name: "Other state",
      type: "select",
      options: { choices: ["Open"] },
    });

    async function createButton(options: Json) {
      return await api.properties.POST(
        jsonRequest(`/api/databases/${database.id}/properties`, "POST", {
          name: "Invalid button",
          type: "button",
          options,
        }),
        routeContext({ id: database.id }),
      );
    }

    assert.equal((await createButton({ actions: [] })).status, 400);
    assert.equal((await createButton({ actions: [
      { type: "set_property", propertyId: foreign.id, value: "x" },
    ] })).status, 400, "a button cannot write to another database");
    assert.equal((await createButton({ actions: [
      { type: "set_property", propertyId: formula.id, value: 1 },
    ] })).status, 400, "a button cannot write a calculated property");
    assert.equal((await createButton({ actions: [
      { type: "set_property", propertyId: choice.id, value: "Three" },
    ] })).status, 400, "values are checked against configured choices");
    assert.equal((await createButton({ actions: [
      {
        type: "set_related_property",
        relationPropertyId: relation.id,
        propertyId: choice.id,
        value: "One",
      },
    ] })).status, 400, "a related action must use the related database's property");
    assert.equal((await createButton({ actions: [
      {
        type: "create_record",
        databaseId: MISSING_ID,
        title: "Missing database",
        values: {},
      },
    ] })).status, 400, "a create action needs an existing database");
    assert.equal((await createButton({ actions: [
      {
        type: "create_record",
        databaseId: other.id,
        title: "Wrong property",
        values: { [choice.id]: "One" },
      },
    ] })).status, 400, "new record values must belong to the chosen database");
    assert.equal((await createButton({ actions: [
      {
        type: "create_record",
        databaseId: other.id,
        title: "Wrong value",
        values: { [otherState.id]: "Closed" },
      },
    ] })).status, 400, "new record values use the property's normal validation");
    assert.equal((await createButton({ actions: [
      {
        type: "create_record",
        databaseId: database.id,
        title: "Calculated value",
        values: { [formula.id]: 2 },
      },
    ] })).status, 400, "calculated properties cannot be initial values");

    const firstButton = await createDatabaseProperty(database.id, {
      name: "First button",
      type: "button",
      options: { actions: [{ type: "set_property", propertyId: choice.id, value: "One" }] },
    });
    assert.equal((await createButton({ actions: [
      { type: "set_property", propertyId: firstButton.id, value: "x" },
    ] })).status, 400, "buttons cannot write buttons");

    const record = await createDatabaseRecord(database.id, { title: "Button target" });
    const directWrite = await api.record.PATCH(
      jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "PATCH", {
        values: { [firstButton.id]: "changed" },
      }),
      routeContext({ id: database.id, recordId: record.id }),
    );
    assert.equal(directWrite.status, 400, "button values cannot be written through record PATCH");

    const notAButton = await api.button.POST(
      jsonRequest(`/api/databases/${database.id}/records/${record.id}/button`, "POST", {
        propertyId: choice.id,
      }),
      routeContext({ id: database.id, recordId: record.id }),
    );
    assert.equal(notAButton.status, 404);
    assert.equal(
      (await api.button.POST(
        jsonRequest(`/api/databases/${other.id}/records/${record.id}/button`, "POST", {
          propertyId: firstButton.id,
        }),
        routeContext({ id: other.id, recordId: record.id }),
      )).status,
      404,
      "a record cannot be run through another database",
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
        jsonRequest(`/api/databases/${database.id}/views`, "POST", { name: "Map", type: "map" }),
        routeContext({ id: database.id }),
      )).status,
      400,
    );
  });

  it("imports a CSV into a database and creates properties for new columns", async () => {
    const database = await createDatabase("CSV import database");
    const { POST } = await import("../../src/app/api/databases/[id]/import/route");
    const response = await POST(
      jsonRequest(`/api/databases/${database.id}/import`, "POST", {
        csv: "Name,Score,Author\nAda,7,Mathematician\nGrace,,Admiral\n",
      }),
      routeContext({ id: database.id }),
    );
    assert.equal(response.status, 201);
    const summary = await body<{ created: number; propertiesCreated: string[] }>(response);
    assert.equal(summary.created, 2);
    assert.deepEqual(summary.propertiesCreated, ["Score", "Author"]);

    const loaded = await body<{
      properties: { id: string; name: string }[];
      records: { title: string; values: Record<string, unknown> }[];
    }>(
      await api.database.GET(
        jsonRequest(`/api/databases/${database.id}`, "GET"),
        routeContext({ id: database.id }),
      ),
    );
    const scoreId = loaded.properties.find((property) => property.name === "Score")?.id;
    const authorId = loaded.properties.find((property) => property.name === "Author")?.id;
    assert.ok(scoreId);
    assert.ok(authorId);
    assert.deepEqual(
      loaded.records.map((record) => [record.title, record.values[scoreId], record.values[authorId]]),
      [["Ada", "7", "Mathematician"], ["Grace", undefined, "Admiral"]],
    );

    assert.equal(
      (await POST(
        jsonRequest(`/api/databases/${database.id}/import`, "POST", { csv: "" }),
        routeContext({ id: database.id }),
      )).status,
      400,
    );
  });

  it("saves a complete view order in one request", async () => {
    const database = await createDatabase("Reorder views database");
    const extraResponse = await api.views.POST(
      jsonRequest(`/api/databases/${database.id}/views`, "POST", { name: "Extra", type: "gallery" }),
      routeContext({ id: database.id }),
    );
    assert.equal(extraResponse.status, 201);
    const extra = await body<{ id: string }>(extraResponse);

    const loaded = await body<{ views: { id: string }[] }>(
      await api.database.GET(
        jsonRequest(`/api/databases/${database.id}`, "GET"),
        routeContext({ id: database.id }),
      ),
    );
    const ids = loaded.views.map((view) => view.id);
    assert.ok(ids.includes(extra.id));

    const reversed = [...ids].reverse();
    const reorderResponse = await api.viewReorder.POST(
      jsonRequest(`/api/databases/${database.id}/views/reorder`, "POST", { viewIds: reversed }),
      routeContext({ id: database.id }),
    );
    assert.equal(reorderResponse.status, 200);

    const reordered = await body<{ views: { id: string }[] }>(
      await api.database.GET(
        jsonRequest(`/api/databases/${database.id}`, "GET"),
        routeContext({ id: database.id }),
      ),
    );
    assert.deepEqual(reordered.views.map((view) => view.id), reversed);

    assert.equal(
      (await api.viewReorder.POST(
        jsonRequest(`/api/databases/${database.id}/views/reorder`, "POST", { viewIds: [ids[0]] }),
        routeContext({ id: database.id }),
      )).status,
      400,
      "the order must list every view",
    );
    assert.equal(
      (await api.viewReorder.POST(
        jsonRequest(`/api/databases/${database.id}/views/reorder`, "POST", {
          viewIds: [...reversed, MISSING_ID],
        }),
        routeContext({ id: database.id }),
      )).status,
      400,
      "a foreign view id is rejected",
    );
    assert.equal(
      (await api.viewReorder.POST(
        jsonRequest(`/api/databases/${database.id}/views/reorder`, "POST", {
          viewIds: [ids[0], ids[0]],
        }),
        routeContext({ id: database.id }),
      )).status,
      400,
      "a repeated view is rejected",
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

  it("computes chart widgets with their saved shape and calculated values", async () => {
    const database = await createDatabase("Dashboard chart database");
    const score = await createDatabaseProperty(database.id, { name: "Score", type: "number" });
    const status = await createDatabaseProperty(database.id, {
      name: "Status",
      type: "select",
      options: { choices: ["Todo", "Done"] },
    });
    const when = await createDatabaseProperty(database.id, { name: "When", type: "date" });
    const recordIds: string[] = [];
    for (const [title, value, statusValue, date] of [
      ["Alpha", 7, "Done", "2026-11-20"],
      ["Beta", 3, "Todo", "2026-11-10"],
    ] as const) {
      const record = await createDatabaseRecord(database.id, { title });
      recordIds.push(record.id);
      const updated = await api.record.PATCH(
        jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "PATCH", {
          values: { [score.id]: value, [status.id]: statusValue, [when.id]: date },
        }),
        routeContext({ id: database.id, recordId: record.id }),
      );
      assert.equal(updated.status, 200);
    }
    await createDatabaseRecord(database.id, { title: "Gamma" });

    const createChartView = async (
      name: string,
      chartType: string,
      config: Record<string, unknown> = {},
    ) => {
      const response = await api.views.POST(
        jsonRequest(`/api/databases/${database.id}/views`, "POST", {
          name,
          type: "chart",
          config: { chartPropertyId: score.id, chartType, ...config },
        }),
        routeContext({ id: database.id }),
      );
      assert.equal(response.status, 201);
      return await body<{ id: string }>(response);
    };
    const pie = await createChartView("Dashboard pie", "pie");
    const line = await createChartView("Dashboard line", "line");
    const grouped = await createChartView("Dashboard grouped", "pie", {
      chartGroupPropertyId: status.id,
    });
    const datedLine = await createChartView("Dashboard dated line", "line", {
      chartDatePropertyId: when.id,
    });
    const datedWindow = await createChartView("Dashboard dated window", "line", {
      chartDatePropertyId: when.id,
      chartDateRange: 7,
    });
    const datedPie = await createChartView("Dashboard dated pie", "pie", {
      chartGroupPropertyId: status.id,
      chartDatePropertyId: when.id,
      chartDateRange: 7,
    });
    const datedBars = await createChartView("Dashboard dated bars", "bars", {
      chartGroupPropertyId: status.id,
      chartDatePropertyId: when.id,
      chartDateRange: 7,
    });

    const data = await body<{
      widgets: {
        view: { id: string };
        chart: {
          type: string;
          property: { name: string };
          groupProperty: { name: string } | null;
          dateProperty: { name: string } | null;
          dateRange: number;
          dateOffset: number;
          chart: { data: { label: string; value: number }[]; skipped: number };
          series: {
            points: { label: string; value: number; date?: string }[];
            min: number;
            max: number;
            from?: string;
            to?: string;
            undated?: number;
            outside?: number;
          } | null;
        } | null;
      }[];
    }>(
      await api.dashboard.GET(
        new Request(
          `http://localhost/api/dashboard?viewIds=${pie.id},${line.id},${grouped.id},${datedLine.id},${datedWindow.id}&today=2026-11-08`,
        ),
      ),
    );

    const pieWidget = data.widgets.find((widget) => widget.view.id === pie.id);
    assert.ok(pieWidget?.chart, "a chart view should return its chart payload");
    assert.equal(pieWidget.chart.type, "pie");
    assert.equal(pieWidget.chart.property.name, "Score");
    assert.deepEqual(
      pieWidget.chart.chart.data.map((datum) => [datum.label, datum.value]),
      [["Alpha", 7], ["Beta", 3]],
    );
    assert.equal(pieWidget.chart.chart.skipped, 1);
    assert.equal(
      pieWidget.chart.series?.points.length,
      2,
      "a chart widget carries line points so its shape can switch in place",
    );

    const lineWidget = data.widgets.find((widget) => widget.view.id === line.id);
    assert.ok(lineWidget?.chart?.series, "a line view should return series points");
    assert.equal(lineWidget.chart.type, "line");
    assert.deepEqual(
      lineWidget.chart.series.points.map((point) => [point.label, point.value]),
      [["Alpha", 7], ["Beta", 3]],
    );
    assert.equal(lineWidget.chart.series.min, 0);
    assert.equal(lineWidget.chart.series.max, 7);

    const groupedWidget = data.widgets.find((widget) => widget.view.id === grouped.id);
    assert.ok(groupedWidget?.chart, "a grouped chart should return its payload");
    assert.equal(groupedWidget.chart.groupProperty?.name, "Status");
    assert.deepEqual(
      groupedWidget.chart.chart.data.map((datum) => [datum.label, datum.value]),
      [["Done", 7], ["Todo", 3]],
      "a dashboard chart groups values by the saved select property",
    );
    assert.equal(recordIds.length, 2);

    const datedWidget = data.widgets.find((widget) => widget.view.id === datedLine.id);
    assert.ok(datedWidget?.chart?.series, "a dated line should return series points");
    assert.equal(datedWidget.chart.dateProperty?.name, "When");
    assert.deepEqual(
      datedWidget.chart.series.points.map((point) => [point.label, point.date, point.value]),
      [["Beta", "2026-11-10", 3], ["Alpha", "2026-11-20", 7]],
      "a dated line sorts chronologically",
    );
    assert.equal(datedWidget.chart.series.from, "2026-11-10");
    assert.equal(datedWidget.chart.series.to, "2026-11-20");
    assert.equal(datedWidget.chart.dateRange, 30, "the default window is 30 days");
    assert.equal(datedWidget.chart.dateOffset, 0, "the default window ends today");

    const windowWidget = data.widgets.find((widget) => widget.view.id === datedWindow.id);
    assert.ok(windowWidget?.chart?.series, "a dated line should keep its series");
    assert.equal(windowWidget.chart.dateRange, 7);
    assert.deepEqual(
      windowWidget.chart.series.points.map((point) => [point.label, point.date]),
      [["Beta", "2026-11-10"]],
      "a seven-day window keeps the near date and leaves the far one out",
    );
    assert.equal(windowWidget.chart.series.outside, 1);

    const windowData = await body<{
      widgets: {
        view: { id: string };
        chart: {
          chart: { data: { label: string; value: number }[] };
        } | null;
      }[];
    }>(
      await api.dashboard.GET(
        new Request(
          `http://localhost/api/dashboard?viewIds=${datedPie.id},${datedBars.id}&today=2026-11-08`,
        ),
      ),
    );
    for (const [view, name] of [
      [datedPie, "Dashboard dated pie"],
      [datedBars, "Dashboard dated bars"],
    ] as const) {
      const widget = windowData.widgets.find((candidate) => candidate.view.id === view.id);
      assert.ok(widget?.chart, `${name} should return its chart payload`);
      assert.deepEqual(
        widget.chart.chart.data.map((datum) => [datum.label, datum.value]),
        [["Todo", 3]],
        `${name} totals stay inside the active date window`,
      );
    }
  });

  it("shifts a chart window into the past", async () => {
    const database = await createDatabase("Dashboard window history database");
    const score = await createDatabaseProperty(database.id, { name: "Score", type: "number" });
    const when = await createDatabaseProperty(database.id, { name: "When", type: "date" });
    for (const [title, value, date] of [
      ["Old", 5, "2026-10-05"],
      ["New", 9, "2026-11-07"],
    ] as const) {
      const record = await createDatabaseRecord(database.id, { title });
      const updated = await api.record.PATCH(
        jsonRequest(`/api/databases/${database.id}/records/${record.id}`, "PATCH", {
          values: { [score.id]: value, [when.id]: date },
        }),
        routeContext({ id: database.id, recordId: record.id }),
      );
      assert.equal(updated.status, 200);
    }

    const response = await api.views.POST(
      jsonRequest(`/api/databases/${database.id}/views`, "POST", {
        name: "Shifted window",
        type: "chart",
        config: {
          chartPropertyId: score.id,
          chartType: "line",
          chartDatePropertyId: when.id,
          chartDateRange: 30,
          chartDateOffset: -30,
        },
      }),
      routeContext({ id: database.id }),
    );
    assert.equal(response.status, 201);
    const view = await body<{ id: string }>(response);

    const octoberResponse = await api.views.POST(
      jsonRequest(`/api/databases/${database.id}/views`, "POST", {
        name: "October window",
        type: "chart",
        config: {
          chartPropertyId: score.id,
          chartType: "line",
          chartDatePropertyId: when.id,
          chartDateStart: "2026-10-01",
          chartDateEnd: "2026-10-31",
        },
      }),
      routeContext({ id: database.id }),
    );
    assert.equal(octoberResponse.status, 201);
    const october = await body<{ id: string }>(octoberResponse);

    const presetResponse = await api.views.POST(
      jsonRequest(`/api/databases/${database.id}/views`, "POST", {
        name: "Preset window",
        type: "chart",
        config: {
          chartPropertyId: score.id,
          chartType: "line",
          chartDatePropertyId: when.id,
          chartDatePreset: "last-month",
          // Saved dates are ignored while a preset is active.
          chartDateStart: "2026-01-01",
          chartDateEnd: "2026-01-31",
        },
      }),
      routeContext({ id: database.id }),
    );
    assert.equal(presetResponse.status, 201);
    const preset = await body<{ id: string }>(presetResponse);

    const data = await body<{
      widgets: {
        view: { id: string };
        chart: {
          dateOffset: number;
          dateStart: string | null;
          dateEnd: string | null;
          datePreset: string | null;
          series: {
            points: { label: string; value: number; date?: string }[];
            outside?: number;
            inWindow?: number;
          } | null;
        } | null;
      }[];
    }>(
      await api.dashboard.GET(
        new Request(
          `http://localhost/api/dashboard?viewIds=${view.id},${october.id},${preset.id}&today=2026-11-08`,
        ),
      ),
    );
    const widget = data.widgets.find((candidate) => candidate.view.id === view.id);
    assert.ok(widget?.chart?.series, "a shifted window should keep its series");
    assert.equal(widget.chart.dateOffset, -30);
    assert.deepEqual(
      widget.chart.series.points.map((point) => [point.label, point.date]),
      [["Old", "2026-10-05"], ["New", "2026-11-07"]],
      "shifting back thirty days brings the earlier record into the window",
    );
    assert.equal(widget.chart.series.outside, 0, "both records fall inside the shifted window");
    assert.equal(widget.chart.series.inWindow, 2);

    const octoberWidget = data.widgets.find((candidate) => candidate.view.id === october.id);
    assert.ok(octoberWidget?.chart?.series, "an explicit range should keep its series");
    assert.equal(octoberWidget.chart.dateStart, "2026-10-01");
    assert.equal(octoberWidget.chart.dateEnd, "2026-10-31");
    assert.deepEqual(
      octoberWidget.chart.series.points.map((point) => point.label),
      ["Old"],
      "an explicit range overrides the rolling window",
    );
    assert.equal(
      octoberWidget.chart.series.outside,
      1,
      "the newer record falls outside the explicit October range",
    );
    assert.equal(octoberWidget.chart.series.inWindow, 1, "only the October record is in range");

    const presetWidget = data.widgets.find((candidate) => candidate.view.id === preset.id);
    assert.ok(presetWidget?.chart?.series, "a month preset should keep its series");
    assert.equal(presetWidget.chart.datePreset, "last-month");
    assert.equal(
      presetWidget.chart.dateStart,
      "2026-10-01",
      "Last month follows the request's today",
    );
    assert.equal(presetWidget.chart.dateEnd, "2026-10-31");
    assert.deepEqual(
      presetWidget.chart.series.points.map((point) => point.label),
      ["Old"],
      "the preset window replaces the saved explicit dates",
    );
    assert.equal(presetWidget.chart.series.outside, 1);
    assert.equal(presetWidget.chart.series.inWindow, 1);
  });

  it("lists databases with their properties for the dashboard pickers", async () => {
    const database = await createDatabase("Picker database");
    await createDatabaseProperty(database.id, { name: "Due", type: "date" });

    const data = await body<{
      databases: { id: string; name: string; properties: { name: string; type: string }[] }[];
    }>(await api.dashboard.GET(new Request("http://localhost/api/dashboard")));

    const listed = data.databases.find((candidate) => candidate.id === database.id);
    assert.ok(listed);
    assert.equal(listed.name, "Picker database");
    assert.ok(listed.properties.some((property) => property.name === "Due" && property.type === "date"));
  });

  it("builds a timeline from dated records across databases", async () => {
    const tasks = await createDatabase("Timeline tasks");
    const releases = await createDatabase("Timeline releases");
    const due = await createDatabaseProperty(tasks.id, { name: "Due", type: "date" });
    const release = await createDatabaseProperty(releases.id, { name: "Release", type: "date" });

    async function recordWithDate(
      databaseId: string,
      title: string,
      propertyId: string,
      date: string,
    ) {
      const record = await createDatabaseRecord(databaseId, { title });
      const updated = await api.record.PATCH(
        jsonRequest(`/api/databases/${databaseId}/records/${record.id}`, "PATCH", {
          values: { [propertyId]: date },
        }),
        routeContext({ id: databaseId, recordId: record.id }),
      );
      assert.equal(updated.status, 200);
      return record;
    }

    const today = "2026-05-10";
    const overdue = await recordWithDate(tasks.id, "Timeline overdue", due.id, "2026-05-04");
    const upcoming = await recordWithDate(tasks.id, "Timeline upcoming", due.id, "2026-05-14");
    const releaseSoon = await recordWithDate(releases.id, "Timeline release", release.id, "2026-05-20");
    const farOut = await recordWithDate(releases.id, "Timeline far out", release.id, "2026-09-01");
    const undated = await createDatabaseRecord(tasks.id, { title: "Timeline undated" });

    const data = await body<{
      timeline: {
        today: string;
        range: number;
        from: string;
        to: string;
        dateProperties: number;
        total: number;
        entries: {
          recordId: string;
          title: string;
          databaseId: string;
          databaseName: string;
          propertyId: string;
          propertyName: string;
          date: string;
        }[];
      } | null;
    }>(await api.dashboard.GET(new Request(
      `http://localhost/api/dashboard?timeline=1&timelineDays=30&today=${today}`,
    )));

    const timeline = data.timeline;
    assert.ok(timeline);
    assert.equal(timeline.today, today);
    assert.equal(timeline.range, 30);
    assert.equal(timeline.from, "2026-05-03");
    assert.equal(timeline.to, "2026-06-09");
    assert.ok(timeline.dateProperties >= 2);
    assert.deepEqual(
      timeline.entries.map((row) => row.title),
      ["Timeline overdue", "Timeline upcoming", "Timeline release"],
      "entries merge databases and sort by date",
    );
    assert.equal(timeline.total, 3);
    assert.ok(!timeline.entries.some((row) => row.recordId === farOut.id), "dates past the horizon are left out");
    assert.ok(!timeline.entries.some((row) => row.recordId === undated.id), "undated records are left out");

    const merged = timeline.entries.find((row) => row.recordId === releaseSoon.id);
    assert.equal(merged?.databaseId, releases.id);
    assert.equal(merged?.databaseName, "Timeline releases");
    assert.equal(merged?.propertyName, "Release");
    assert.equal(timeline.entries.find((row) => row.recordId === upcoming.id)?.databaseName, "Timeline tasks");
    assert.ok(overdue);

    const narrowed = await body<{ timeline: { entries: { title: string }[]; to: string } }>(
      await api.dashboard.GET(new Request(
        `http://localhost/api/dashboard?timeline=1&timelineDays=7&today=${today}`,
      )),
    );
    assert.equal(narrowed.timeline.to, "2026-05-17");
    assert.deepEqual(
      narrowed.timeline.entries.map((row) => row.title),
      ["Timeline overdue", "Timeline upcoming"],
    );

    const notRequested = await body<{ timeline: unknown }>(
      await api.dashboard.GET(new Request("http://localhost/api/dashboard")),
    );
    assert.equal(notRequested.timeline, null, "the timeline is only computed when asked for");
  });

  it("returns due-soon tasks and current projects for the home queues", async () => {
    async function recordWithValues(
      databaseId: string,
      title: string,
      values: Record<string, unknown> = {},
    ) {
      const record = await createDatabaseRecord(databaseId, { title });
      if (Object.keys(values).length > 0) {
        const updated = await api.record.PATCH(
          jsonRequest(`/api/databases/${databaseId}/records/${record.id}`, "PATCH", { values }),
          routeContext({ id: databaseId, recordId: record.id }),
        );
        assert.equal(updated.status, 200);
      }
      return record;
    }

    const tasksDatabase = await createDatabase("Tasks");
    const due = await createDatabaseProperty(tasksDatabase.id, { name: "Due", type: "date" });
    const status = await createDatabaseProperty(tasksDatabase.id, {
      name: "Status",
      type: "select",
      options: { choices: ["Todo", "In progress", "Done"] },
    });

    await recordWithValues(tasksDatabase.id, "Overdue task", { [due.id]: "2026-03-02", [status.id]: "Todo" });
    await recordWithValues(tasksDatabase.id, "Today task", { [due.id]: "2026-03-10", [status.id]: "In progress" });
    await recordWithValues(tasksDatabase.id, "Soon task", { [due.id]: "2026-03-13", [status.id]: "Todo" });
    await recordWithValues(tasksDatabase.id, "Later task", { [due.id]: "2026-04-10", [status.id]: "Todo" });
    await recordWithValues(tasksDatabase.id, "Finished task", { [due.id]: "2026-03-02", [status.id]: "Done" });
    await recordWithValues(tasksDatabase.id, "Undated task", { [status.id]: "Todo" });

    const projectsDatabase = await createDatabase("Projects");
    const stage = await createDatabaseProperty(projectsDatabase.id, {
      name: "Stage",
      type: "select",
      options: { choices: ["Planning", "In progress", "Done"] },
    });
    await recordWithValues(projectsDatabase.id, "Active project", { [stage.id]: "In progress" });
    await recordWithValues(projectsDatabase.id, "Shipped project", { [stage.id]: "Done" });
    await recordWithValues(projectsDatabase.id, "Unstaged project");

    const response = await api.dashboard.GET(
      new Request(
        `http://localhost/api/dashboard?today=2026-03-10&taskDatabaseId=${tasksDatabase.id}&taskPropertyId=${due.id}&projectDatabaseId=${projectsDatabase.id}`,
      ),
    );
    assert.equal(response.status, 200);
    const data = await body<{
      tasks: {
        databaseName: string;
        property: { name: string };
        overdue: number;
        total: number;
        records: { title: string; due: string; bucket: string }[];
      } | null;
      projects: {
        databaseName: string;
        property: { name: string } | null;
        total: number;
        records: { title: string; status: string }[];
      } | null;
    }>(response);

    assert.ok(data.tasks);
    assert.equal(data.tasks.databaseName, "Tasks");
    assert.equal(data.tasks.property.name, "Due");
    assert.equal(data.tasks.total, 3, "overdue, today, and within a week");
    assert.equal(data.tasks.overdue, 1);
    assert.deepEqual(
      data.tasks.records.map((record) => [record.title, record.due, record.bucket]),
      [
        ["Overdue task", "2026-03-02", "overdue"],
        ["Today task", "2026-03-10", "today"],
        ["Soon task", "2026-03-13", "soon"],
      ],
    );

    assert.ok(data.projects);
    assert.equal(data.projects.property?.name, "Stage", "the first status property is used by default");
    assert.equal(data.projects.total, 2, "completed projects are left out");
    assert.deepEqual(
      data.projects.records.map((record) => record.title).sort(),
      ["Active project", "Unstaged project"],
    );

    const phase = await createDatabaseProperty(tasksDatabase.id, {
      name: "Phase",
      type: "select",
      options: { choices: ["Draft", "Archived"] },
    });
    await recordWithValues(tasksDatabase.id, "Archived draft task", {
      [due.id]: "2026-03-11",
      [status.id]: "Todo",
      [phase.id]: "Archived",
    });

    const chosenStatus = await body<{
      tasks: { statusProperty: { name: string } | null; records: { title: string }[] } | null;
    }>(
      await api.dashboard.GET(
        new Request(
          `http://localhost/api/dashboard?today=2026-03-10&taskDatabaseId=${tasksDatabase.id}&taskPropertyId=${due.id}&taskStatusPropertyId=${phase.id}`,
        ),
      ),
    );
    assert.ok(chosenStatus.tasks);
    assert.equal(chosenStatus.tasks.statusProperty?.name, "Phase");
    assert.equal(
      chosenStatus.tasks.records.some((record) => record.title === "Archived draft task"),
      false,
      "the chosen status property decides what counts as finished",
    );

    const unfiltered = await body<{
      tasks: { statusProperty: unknown; records: { title: string }[] } | null;
    }>(
      await api.dashboard.GET(
        new Request(
          `http://localhost/api/dashboard?today=2026-03-10&taskDatabaseId=${tasksDatabase.id}&taskPropertyId=${due.id}&taskStatusPropertyId=none`,
        ),
      ),
    );
    assert.ok(unfiltered.tasks);
    assert.equal(unfiltered.tasks.statusProperty, null);
    assert.ok(
      unfiltered.tasks.records.some((record) => record.title === "Finished task"),
      "no status filter keeps finished records",
    );

    const customExclusions = await body<{
      projects: { records: { title: string }[]; total: number } | null;
    }>(
      await api.dashboard.GET(
        new Request(
          `http://localhost/api/dashboard?projectDatabaseId=${projectsDatabase.id}&projectExcludedStatus=in%20progress&projectExcludedStatus=Planning`,
        ),
      ),
    );
    assert.ok(customExclusions.projects);
    assert.deepEqual(
      customExclusions.projects.records.map((record) => record.title).sort(),
      ["Shipped project", "Unstaged project"],
      "chosen statuses replace the built-in vocabulary and compare without case",
    );

    const ignored = await body<{ tasks: unknown }>(
      await api.dashboard.GET(
        new Request(
          `http://localhost/api/dashboard?taskDatabaseId=${MISSING_ID}&taskPropertyId=${due.id}`,
        ),
      ),
    );
    assert.equal(ignored.tasks, null, "an unknown task database is ignored");

    const wrongProperty = await body<{ tasks: unknown }>(
      await api.dashboard.GET(
        new Request(
          `http://localhost/api/dashboard?taskDatabaseId=${projectsDatabase.id}&taskPropertyId=${due.id}`,
        ),
      ),
    );
    assert.equal(wrongProperty.tasks, null, "a date property from another database is ignored");
  });
});

describe("search API", () => {
  it("handles empty and oversized queries", async () => {
    assert.deepEqual(
      await body(await api.search.GET(new Request("http://localhost/api/search"))),
      { results: [] },
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
      results: { type: string; id: string; title: string; databaseName?: string }[];
    }>(response);
    const pageHits = results.results.filter((hit) => hit.type === "page");
    const recordHits = results.results.filter((hit) => hit.type === "record");
    assert.ok(pageHits.some((hit) => hit.id === page.id));
    assert.ok(!pageHits.some((hit) => hit.id === trashed.id));
    assert.ok(recordHits.some((hit) => hit.id === record.id && hit.databaseName === `${token} database`));
  });

  it("ranks title matches above body mentions, regardless of recency", async () => {
    const token = "TungstenRankToken";
    // The body-only page and the value-only record are created last, so
    // ordering by updated_at alone would put both of them first.
    const exact = await createPage({ title: token, content: "An exact title." });
    const prefix = await createPage({ title: `${token} planning`, content: "No mention here." });
    const bodyOnly = await createPage({ title: "Weekly review", content: `Passing ${token} mention.` });

    const database = await createDatabase(`${token} ranking database`);
    const notes = await createDatabaseProperty(database.id, { name: "Notes", type: "text" });
    const titleRecord = await createDatabaseRecord(database.id, {
      title: `${token} record`,
      values: { [notes.id]: "No mention here." },
    });
    // Record values are written by PATCH, not at creation.
    const valueOnly = await createDatabaseRecord(database.id, { title: "Unrelated record" });
    const patched = await api.record.PATCH(
      jsonRequest(`/api/databases/${database.id}/records/${valueOnly.id}`, "PATCH", {
        values: { [notes.id]: `${token} buried in a property` },
      }),
      routeContext({ id: database.id, recordId: valueOnly.id }),
    );
    assert.equal(patched.status, 200);

    const results = await body<{
      results: { type: string; id: string; score: number; match: string }[];
    }>(
      await api.search.GET(
        new Request(`http://localhost/api/search?q=${encodeURIComponent(token)}`),
      ),
    );

    // Pages and records come back in one list, so compare positions in it.
    // A record's own page is also a title-prefix match, so assert relative
    // order instead of the whole list.
    const order = results.results.map((hit) => hit.id);
    assert.equal(order[0], exact.id, "an exact title outranks every other title match");
    assert.ok(
      order.indexOf(prefix.id) < order.indexOf(bodyOnly.id),
      "a title prefix outranks a body mention",
    );
    assert.ok(
      order.indexOf(titleRecord.id) < order.indexOf(valueOnly.id),
      "a record title match ranks above a value match",
    );
    assert.ok(
      results.results.every((hit, index) => index === 0 || results.results[index - 1].score >= hit.score),
      "the merged list descends by relevance score",
    );
    assert.ok(
      results.results.every((hit) => Number.isFinite(hit.score)),
      "every hit carries a numeric relevance score",
    );

    // The reason travels with the score so the palette can explain the order.
    const reasonFor = new Map(results.results.map((hit) => [hit.id, hit.match]));
    assert.equal(reasonFor.get(exact.id), "title");
    assert.equal(reasonFor.get(prefix.id), "title");
    assert.equal(reasonFor.get(bodyOnly.id), "content");
    assert.equal(reasonFor.get(titleRecord.id), "title");
    assert.equal(reasonFor.get(valueOnly.id), "content");
  });

  it("nudges favorites up inside a match bucket without crossing buckets", async () => {
    const token = "CobaltFavoriteToken";
    const favoriteBody = await createPage({
      title: "Reading notes",
      content: `A quiet mention of ${token}.`,
    });
    await api.page.PATCH(
      jsonRequest(`/api/pages/${favoriteBody.id}`, "PATCH", { isFavorite: true }),
      routeContext({ id: favoriteBody.id }),
    );
    // Created after the favorite, so recency alone would order it first; both
    // titles share no trigrams with the term, so only the favorite bonus can
    // separate them.
    const plainBody = await createPage({
      title: "Errand notes",
      content: `Another mention of ${token}.`,
    });
    const titleMatch = await createPage({ title: `${token} brief`, content: "No mention here." });

    const results = await body<{ results: { id: string }[] }>(
      await api.search.GET(
        new Request(`http://localhost/api/search?q=${encodeURIComponent(token)}`),
      ),
    );
    const order = results.results.map((hit) => hit.id);

    assert.ok(
      order.indexOf(favoriteBody.id) < order.indexOf(plainBody.id),
      "a favorite outranks an equally matching page that is merely newer",
    );
    assert.ok(
      order.indexOf(titleMatch.id) < order.indexOf(favoriteBody.id),
      "a favorite body mention stays below a page named after the term",
    );
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

describe("focus API", () => {
  it("gathers a project's tasks, subpages, and references", async () => {
    const project = await createPage({
      title: `Focus project ${Date.now()}`,
      contentJson: focusDocument([
        { text: "Define scope", checked: false },
        { text: "Collect references", checked: true },
      ]),
    });
    const child = await createPage({
      title: `${project.title} outline`,
      parentId: project.id,
      contentJson: focusDocument([{ text: "Draft outline", checked: false }]),
    });
    const reference = await createPage({ title: `Focus reference ${Date.now()}` });
    await api.links.POST(
      jsonRequest(`/api/pages/${project.id}/links`, "POST", { targetPageId: reference.id }),
      routeContext({ id: project.id }),
    );

    const database = await createDatabase(`Focus database ${Date.now()}`);
    const record = await createDatabaseRecord(database.id, { title: "Focus record" });
    await api.pageRecords.POST(
      jsonRequest(`/api/pages/${project.id}/records`, "POST", { recordId: record.id }),
      routeContext({ id: project.id }),
    );

    const response = await api.focus.GET(
      jsonRequest(`/api/pages/${project.id}/focus`, "GET"),
      routeContext({ id: project.id }),
    );
    assert.equal(response.status, 200);

    const data = await body<{
      project: { id: string; title: string; isFavorite: boolean };
      tasks: { pageId: string; pageTitle: string; path: number[]; text: string; checked: boolean }[];
      pages: { id: string; title: string }[];
      references: {
        links: { id: string }[];
        backlinks: { id: string }[];
        records: { id: string; databaseName: string }[];
      };
      progress: { total: number; done: number; open: number; percent: number };
    }>(response);

    assert.equal(data.project.id, project.id);
    assert.equal(data.project.isFavorite, false);
    assert.deepEqual(
      data.tasks.map(({ text }) => text),
      ["Define scope", "Collect references", "Draft outline"],
    );
    assert.deepEqual(data.tasks[0].path, [1, 0], "a task keeps the path to its checkbox");
    assert.equal(data.tasks[0].pageId, project.id);
    assert.equal(data.tasks[2].pageId, child.id);
    assert.equal(data.tasks[2].pageTitle, child.title);
    assert.deepEqual(data.pages.map(({ id }) => id), [child.id]);
    assert.deepEqual(data.references.links.map(({ id }) => id), [reference.id]);
    assert.deepEqual(
      data.references.records.map(({ id, databaseName }) => ({ id, databaseName })),
      [{ id: record.id, databaseName: database.name }],
    );
    assert.deepEqual(data.progress, { total: 3, done: 1, open: 2, percent: 33 });

    // Pinning the project is the page's own favorite flag, so the focus view
    // and the rest of the workspace agree on what is pinned.
    await api.page.PATCH(
      jsonRequest(`/api/pages/${project.id}`, "PATCH", { isFavorite: true }),
      routeContext({ id: project.id }),
    );
    const pinned = await body<{ project: { isFavorite: boolean } }>(
      await api.focus.GET(
        jsonRequest(`/api/pages/${project.id}/focus`, "GET"),
        routeContext({ id: project.id }),
      ),
    );
    assert.equal(pinned.project.isFavorite, true);
  });

  it("lists pinned projects with task progress and skips pages with no work", async () => {
    const pinned = await createPage({
      title: `Pinned project ${Date.now()}`,
      contentJson: focusDocument([
        { text: "Pinned open task", checked: false },
        { text: "Pinned done task", checked: true },
      ]),
    });
    const child = await createPage({
      title: `${pinned.title} child`,
      parentId: pinned.id,
      contentJson: focusDocument([{ text: "Pinned child task", checked: false }]),
    });
    const pinnedWithoutTasks = await createPage({
      title: `Pinned notes ${Date.now()}`,
    });
    const unpinnedWithTasks = await createPage({
      title: `Unpinned project ${Date.now()}`,
      contentJson: focusDocument([{ text: "Unpinned task", checked: false }]),
    });

    await api.page.PATCH(
      jsonRequest(`/api/pages/${pinned.id}`, "PATCH", { isFavorite: true }),
      routeContext({ id: pinned.id }),
    );
    await api.page.PATCH(
      jsonRequest(`/api/pages/${pinnedWithoutTasks.id}`, "PATCH", { isFavorite: true }),
      routeContext({ id: pinnedWithoutTasks.id }),
    );

    const response = await api.focusPinned.GET(jsonRequest("/api/focus/pinned", "GET"));
    assert.equal(response.status, 200);

    const data = await body<{
      projects: {
        id: string;
        title: string;
        progress: { total: number; done: number; open: number };
        tasks: { text: string; checked: boolean }[];
      }[];
    }>(response);

    const listed = data.projects.find((project) => project.id === pinned.id);
    assert.ok(listed, "a pinned project with tasks is listed");
    assert.deepEqual(listed.progress, { total: 3, done: 1, open: 2, percent: 33 });
    assert.deepEqual(
      listed.tasks.map(({ text, checked }) => ({ text, checked })),
      [
        { text: "Pinned open task", checked: false },
        { text: "Pinned child task", checked: false },
      ],
      "a card carries the open tasks from the project and its subpage",
    );
    assert.equal(
      data.projects.some((project) => project.id === pinnedWithoutTasks.id),
      false,
      "a pinned page with no tasks has no progress to show",
    );
    assert.equal(
      data.projects.some((project) => project.id === unpinnedWithTasks.id),
      false,
      "an unpinned project is left to the focus view",
    );

    // Checking tasks off records a short history for the card, newest first.
    for (const [pageId, text] of [
      [pinned.id, "Pinned open task"],
      [child.id, "Pinned child task"],
      [pinned.id, "Pinned done task"],
    ] as const) {
      const recorded = await api.taskCompletions.POST(
        jsonRequest(`/api/pages/${pageId}/task-completions`, "POST", {
          text,
          checked: true,
        }),
        routeContext({ id: pageId }),
      );
      assert.equal(recorded.status, 200);
    }

    const withHistory = await body<{
      projects: { id: string; recentlyCompleted: { text: string }[] }[];
    }>(await api.focusPinned.GET(jsonRequest("/api/focus/pinned", "GET")));
    assert.deepEqual(
      withHistory.projects
        .find((project) => project.id === pinned.id)
        ?.recentlyCompleted.map(({ text }) => text),
      ["Pinned done task", "Pinned child task"],
      "only the two most recent check-offs are shown",
    );

    // Undoing a task removes it from the history again.
    const undone = await api.taskCompletions.POST(
      jsonRequest(`/api/pages/${pinned.id}/task-completions`, "POST", {
        text: "Pinned done task",
        checked: false,
      }),
      routeContext({ id: pinned.id }),
    );
    assert.equal(undone.status, 200);

    const afterUndo = await body<{
      projects: { id: string; recentlyCompleted: { text: string }[] }[];
    }>(await api.focusPinned.GET(jsonRequest("/api/focus/pinned", "GET")));
    assert.deepEqual(
      afterUndo.projects
        .find((project) => project.id === pinned.id)
        ?.recentlyCompleted.map(({ text }) => text),
      ["Pinned child task", "Pinned open task"],
    );

    const emptyText = await api.taskCompletions.POST(
      jsonRequest(`/api/pages/${pinned.id}/task-completions`, "POST", {
        text: "  ",
        checked: true,
      }),
      routeContext({ id: pinned.id }),
    );
    assert.equal(emptyText.status, 400);

    const missingPage = await api.taskCompletions.POST(
      jsonRequest(`/api/pages/${MISSING_ID}/task-completions`, "POST", {
        text: "Anything",
        checked: true,
      }),
      routeContext({ id: MISSING_ID }),
    );
    assert.equal(missingPage.status, 404);
  });

  it("rejects malformed and missing projects", async () => {
    const invalid = await api.focus.GET(
      jsonRequest("/api/pages/nope/focus", "GET"),
      routeContext({ id: "nope" }),
    );
    assert.equal(invalid.status, 400);

    const missing = await api.focus.GET(
      jsonRequest(`/api/pages/${MISSING_ID}/focus`, "GET"),
      routeContext({ id: MISSING_ID }),
    );
    assert.equal(missing.status, 404);
  });
});

describe("reading list API", () => {
  it("creates an item with a notes page and lists its highlights", async () => {
    const title = `Reading item ${Date.now()}`;
    const created = await api.reading.POST(jsonRequest("/api/reading", "POST", {
      title,
      kind: "book",
      author: "Ada Lovelace",
      url: "https://example.com/notes",
      status: "reading",
    }));
    assert.equal(created.status, 201);

    const item = await body<{
      id: string;
      pageId: string;
      title: string;
      kind: string;
      status: string;
      author: string;
      url: string | null;
      highlights: unknown[];
    }>(created);
    assert.equal(item.title, title);
    assert.equal(item.kind, "book");
    assert.equal(item.status, "reading");
    assert.equal(item.author, "Ada Lovelace");
    assert.equal(item.url, "https://example.com/notes");
    assert.deepEqual(item.highlights, []);

    const notesPage = await api.page.GET(
      jsonRequest(`/api/pages/${item.pageId}`, "GET"),
      routeContext({ id: item.pageId }),
    );
    assert.equal(notesPage.status, 200, "the item owns a notes page");
    assert.equal((await body<PageRow>(notesPage)).title, title);

    const highlight = await api.readingHighlights.POST(
      jsonRequest(`/api/reading/${item.id}/highlights`, "POST", {
        text: "A line worth keeping",
        note: "Chapter 2",
      }),
      routeContext({ id: item.id }),
    );
    assert.equal(highlight.status, 201);

    const listed = await body<{ id: string; highlights: { id: string; text: string; note: string }[] }[]>(
      await api.reading.GET(jsonRequest("/api/reading", "GET")),
    );
    const stored = listed.find((row) => row.id === item.id);
    assert.deepEqual(
      stored?.highlights.map(({ text, note }) => ({ text, note })),
      [{ text: "A line worth keeping", note: "Chapter 2" }],
    );

    const updated = await api.readingItem.PATCH(
      jsonRequest(`/api/reading/${item.id}`, "PATCH", { status: "finished" }),
      routeContext({ id: item.id }),
    );
    assert.equal(updated.status, 200);
    assert.equal((await body<{ status: string }>(updated)).status, "finished");

    const removedHighlight = await api.readingHighlight.DELETE(
      jsonRequest(`/api/reading/${item.id}/highlights/${stored?.highlights[0]?.id ?? MISSING_ID}`, "DELETE"),
      routeContext({ id: item.id, highlightId: stored?.highlights[0]?.id ?? MISSING_ID }),
    );
    assert.equal(removedHighlight.status, 200);
  });

  it("rejects untitled items, bad links, unknown kinds, and empty updates", async () => {
    const untitled = await api.reading.POST(jsonRequest("/api/reading", "POST", { title: "  " }));
    assert.equal(untitled.status, 400);

    const badKind = await api.reading.POST(
      jsonRequest("/api/reading", "POST", { title: "Bad kind", kind: "film" }),
    );
    assert.equal(badKind.status, 400);

    const badUrl = await api.reading.POST(
      jsonRequest("/api/reading", "POST", { title: "Bad link", url: "javascript:alert(1)" }),
    );
    assert.equal(badUrl.status, 400);

    const emptyUpdate = await api.readingItem.PATCH(
      jsonRequest(`/api/reading/${MISSING_ID}`, "PATCH", {}),
      routeContext({ id: MISSING_ID }),
    );
    assert.equal(emptyUpdate.status, 400);

    const missingItem = await api.readingItem.PATCH(
      jsonRequest(`/api/reading/${MISSING_ID}`, "PATCH", { status: "finished" }),
      routeContext({ id: MISSING_ID }),
    );
    assert.equal(missingItem.status, 404);

    const invalidId = await api.readingItem.DELETE(
      jsonRequest("/api/reading/nope", "DELETE"),
      routeContext({ id: "nope" }),
    );
    assert.equal(invalidId.status, 400);

    const missingHighlight = await api.readingHighlight.DELETE(
      jsonRequest(`/api/reading/${MISSING_ID}/highlights/${MISSING_ID}`, "DELETE"),
      routeContext({ id: MISSING_ID, highlightId: MISSING_ID }),
    );
    assert.equal(missingHighlight.status, 404);
  });

  it("removing an item keeps its notes page", async () => {
    const created = await body<{ id: string; pageId: string }>(await api.reading.POST(
      jsonRequest("/api/reading", "POST", { title: `Keep notes ${Date.now()}` }),
    ));

    const removed = await api.readingItem.DELETE(
      jsonRequest(`/api/reading/${created.id}`, "DELETE"),
      routeContext({ id: created.id }),
    );
    assert.equal(removed.status, 200);

    const pageStillExists = await api.page.GET(
      jsonRequest(`/api/pages/${created.pageId}`, "GET"),
      routeContext({ id: created.pageId }),
    );
    assert.equal(pageStillExists.status, 200);

    const again = await api.readingItem.DELETE(
      jsonRequest(`/api/reading/${created.id}`, "DELETE"),
      routeContext({ id: created.id }),
    );
    assert.equal(again.status, 404);
  });
});

describe("saved searches API", () => {
  it("stores a filter set and lists it with its tag name", async () => {
    const tag = await body<TagRow>(
      await api.tags.POST(jsonRequest("/api/tags", "POST", { name: `Saved search tag ${Date.now()}` })),
    );
    const created = await api.savedSearches.POST(jsonRequest("/api/saved-searches", "POST", {
      name: "Reading queue",
      query: "habits",
      tagId: tag.id,
      favoritesOnly: true,
    }));
    assert.equal(created.status, 201);

    const saved = await body<{
      id: string;
      name: string;
      query: string;
      tagId: string | null;
      tagName: string | null;
      favoritesOnly: boolean;
    }>(created);
    assert.deepEqual(
      {
        name: saved.name,
        query: saved.query,
        tagId: saved.tagId,
        tagName: saved.tagName,
        favoritesOnly: saved.favoritesOnly,
      },
      {
        name: "Reading queue",
        query: "habits",
        tagId: tag.id,
        tagName: tag.name,
        favoritesOnly: true,
      },
    );

    const listed = await body<{ id: string; tagName: string | null }[]>(
      await api.savedSearches.GET(jsonRequest("/api/saved-searches", "GET")),
    );
    assert.equal(
      listed.find((row) => row.id === saved.id)?.tagName,
      tag.name,
      "the list names the tag the collection filters by",
    );
  });

  it("rejects unnamed collections, overlong queries, and unknown tags", async () => {
    const unnamed = await api.savedSearches.POST(
      jsonRequest("/api/saved-searches", "POST", { name: "   " }),
    );
    assert.equal(unnamed.status, 400);

    const overlong = await api.savedSearches.POST(jsonRequest("/api/saved-searches", "POST", {
      name: "Too long",
      query: "x".repeat(201),
    }));
    assert.equal(overlong.status, 400);

    const badTagShape = await api.savedSearches.POST(
      jsonRequest("/api/saved-searches", "POST", { name: "Bad tag", tagId: "nope" }),
    );
    assert.equal(badTagShape.status, 400);

    const unknownTag = await api.savedSearches.POST(
      jsonRequest("/api/saved-searches", "POST", { name: "Missing tag", tagId: MISSING_ID }),
    );
    assert.equal(unknownTag.status, 404);
  });

  it("deletes only the collection, never the pages it matched", async () => {
    const matched = await createPage({ title: `Saved search page ${Date.now()}` });
    const created = await body<{ id: string }>(await api.savedSearches.POST(
      jsonRequest("/api/saved-searches", "POST", {
        name: `Keep ${Date.now()}`,
        query: matched.title,
      }),
    ));

    const deleted = await api.savedSearch.DELETE(
      jsonRequest(`/api/saved-searches/${created.id}`, "DELETE"),
      routeContext({ id: created.id }),
    );
    assert.equal(deleted.status, 200);

    const pageStillExists = await api.page.GET(
      jsonRequest(`/api/pages/${matched.id}`, "GET"),
      routeContext({ id: matched.id }),
    );
    assert.equal(pageStillExists.status, 200, "the matched page is untouched");

    const again = await api.savedSearch.DELETE(
      jsonRequest(`/api/saved-searches/${created.id}`, "DELETE"),
      routeContext({ id: created.id }),
    );
    assert.equal(again.status, 404);

    const invalid = await api.savedSearch.DELETE(
      jsonRequest("/api/saved-searches/nope", "DELETE"),
      routeContext({ id: "nope" }),
    );
    assert.equal(invalid.status, 400);
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
    assert.ok(defaultPages.every((page) => !page.isRecordPage),
      "pages that remain in the default listing are marked as ordinary pages");

    const favorites = await body<PageRow[]>(await api.pages.GET(jsonRequest(`${base}&favorite=true`, "GET")));
    assert.deepEqual(favorites.map((page) => page.id), [favorite.id]);

    const withInbox = await body<PageRow[]>(await api.pages.GET(jsonRequest(`${base}&includeInbox=true`, "GET")));
    assert.ok(withInbox.some((page) => page.id === inbox.id));
    assert.ok(!withInbox.some((page) => page.id === record.pageId));

    const withRecordPages = await body<PageRow[]>(await api.pages.GET(jsonRequest(`${base}&includeRecordPages=true`, "GET")));
    assert.ok(withRecordPages.some((page) => page.id === record.pageId && page.isRecordPage),
      "record pages are marked when a listing opts into them");
    assert.ok(withRecordPages.some((page) => page.id === regular.id && !page.isRecordPage));
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

  it("restores a nested page without flattening the subtree beneath it", async () => {
    const grandparent = await createPage({ title: "Trash grandparent" });
    const parent = await createPage({ title: "Trash nested parent", parentId: grandparent.id });
    const child = await createPage({ title: "Trash nested child", parentId: parent.id });

    // Trashing the grandparent puts the whole branch in the trash.
    await api.page.DELETE(
      jsonRequest(`/api/pages/${grandparent.id}`, "DELETE"),
      routeContext({ id: grandparent.id }),
    );

    // Restoring the middle page on its own has to leave its trashed parent, but
    // its own child must stay beneath it rather than being moved to the top too.
    const restored = await api.trashRestore.POST(
      jsonRequest(`/api/trash/${parent.id}/restore`, "POST"),
      routeContext({ id: parent.id }),
    );
    assert.equal(restored.status, 200);

    const restoredParent = await body<PageRow>(
      await api.page.GET(jsonRequest(`/api/pages/${parent.id}`, "GET"), routeContext({ id: parent.id })),
    );
    const restoredChild = await body<PageRow>(
      await api.page.GET(jsonRequest(`/api/pages/${child.id}`, "GET"), routeContext({ id: child.id })),
    );
    assert.equal(restoredParent.parentId, null, "the restored root leaves its trashed parent");
    assert.equal(restoredChild.parentId, parent.id, "the restored subtree keeps its own structure");
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

describe("related pages API", () => {
  it("suggests pages with reasons and skips pages already connected", async () => {
    const stamp = Date.now();
    const subject = await createPage({ title: `Related subject ${stamp}` });
    const byTag = await createPage({ title: `Tag neighbour ${stamp}` });
    const byLink = await createPage({ title: `Link neighbour ${stamp}` });
    const byRecord = await createPage({ title: `Record neighbour ${stamp}` });
    const connected = await createPage({ title: `Already connected ${stamp}` });
    const unrelated = await createPage({ title: `Unrelated ${stamp}` });
    const sharedTarget = await createPage({ title: `Shared target ${stamp}` });

    const tagResponse = await api.tags.POST(
      jsonRequest("/api/tags", "POST", { name: `related-${stamp}` }),
    );
    assert.ok(tagResponse.ok);
    const tag = await body<TagRow>(tagResponse);

    for (const page of [subject, byTag]) {
      const assigned = await api.pageTags.POST(
        jsonRequest(`/api/pages/${page.id}/tags`, "POST", { tagId: tag.id }),
        routeContext({ id: page.id }),
      );
      assert.ok(assigned.ok);
    }

    for (const page of [subject, byLink, connected]) {
      const linked = await api.links.POST(
        jsonRequest(`/api/pages/${page.id}/links`, "POST", { targetPageId: sharedTarget.id }),
        routeContext({ id: page.id }),
      );
      assert.equal(linked.status, 201);
    }

    const linkedToConnected = await api.links.POST(
      jsonRequest(`/api/pages/${subject.id}/links`, "POST", { targetPageId: connected.id }),
      routeContext({ id: subject.id }),
    );
    assert.equal(linkedToConnected.status, 201);

    const database = await createDatabase(`Related database ${stamp}`);
    const record = await createDatabaseRecord(database.id, { title: `Shared record ${stamp}` });
    for (const page of [subject, byRecord]) {
      const linked = await api.pageRecords.POST(
        jsonRequest(`/api/pages/${page.id}/records`, "POST", { recordId: record.id }),
        routeContext({ id: page.id }),
      );
      assert.ok(linked.ok);
    }

    const response = await api.related.GET(
      jsonRequest(`/api/pages/${subject.id}/related`, "GET"),
      routeContext({ id: subject.id }),
    );
    assert.equal(response.status, 200);
    const { suggestions } = await body<{
      suggestions: { id: string; title: string; score: number; reasons: string[] }[];
    }>(response);

    const ids = suggestions.map((suggestion) => suggestion.id);
    assert.ok(ids.includes(byTag.id), "a shared tag is enough to suggest a page");
    assert.ok(ids.includes(byLink.id), "a shared link target is enough to suggest a page");
    assert.ok(ids.includes(byRecord.id), "a shared record is enough to suggest a page");
    assert.ok(!ids.includes(unrelated.id), "pages with nothing in common are left out");
    assert.ok(!ids.includes(connected.id), "already connected pages are not suggested");
    assert.ok(!ids.includes(subject.id), "a page never suggests itself");
    assert.ok(!ids.includes(sharedTarget.id), "a page it already links to is not suggested");

    assert.equal(suggestions[0].id, byRecord.id, "records rank above links and tags");
    assert.match(suggestions[0].reasons[0], /Shared record/);
    assert.ok(
      suggestions.some(
        (suggestion) =>
          suggestion.id === byLink.id
          && suggestion.reasons.some((reason) => reason.includes("Shared target")),
      ),
    );
    assert.ok(
      suggestions.some(
        (suggestion) =>
          suggestion.id === byTag.id
          && suggestion.reasons.some((reason) => reason.includes(tag.name)),
      ),
    );
  });

  it("rejects unknown and malformed page IDs", async () => {
    assert.equal(
      (await api.related.GET(
        jsonRequest(`/api/pages/${MISSING_ID}/related`, "GET"),
        routeContext({ id: MISSING_ID }),
      )).status,
      404,
    );
    assert.equal(
      (await api.related.GET(
        jsonRequest("/api/pages/nope/related", "GET"),
        routeContext({ id: "nope" }),
      )).status,
      400,
    );
  });
});

describe("database view types API", () => {
  it("creates list, timeline, and chart views and rejects unknown types", async () => {
    const database = await createDatabase(`View types ${Date.now()}`);

    async function createView(type: string) {
      const response = await api.views.POST(
        jsonRequest(`/api/databases/${database.id}/views`, "POST", { name: type, type }),
        routeContext({ id: database.id }),
      );
      assert.equal(response.status, 201);
      return await body<{ id: string; type: string }>(response);
    }

    assert.equal((await createView("list")).type, "list");
    assert.equal((await createView("timeline")).type, "timeline");
    assert.equal((await createView("chart")).type, "chart");

    const invalid = await api.views.POST(
      jsonRequest(`/api/databases/${database.id}/views`, "POST", { name: "Map", type: "map" }),
      routeContext({ id: database.id }),
    );
    assert.equal(invalid.status, 400);
  });
});
