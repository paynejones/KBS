import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { asc, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { pages as pagesTable } from "../../src/db/schema";
import { createTestDatabase, type TestDatabase } from "./db-harness";

type ApiModules = {
  pages: typeof import("../../src/app/api/pages/route");
  page: typeof import("../../src/app/api/pages/[id]/route");
  move: typeof import("../../src/app/api/pages/move/route");
  reorder: typeof import("../../src/app/api/pages/reorder/route");
  revisions: typeof import("../../src/app/api/pages/[id]/revisions/route");
  pageTags: typeof import("../../src/app/api/pages/[id]/tags/route");
  links: typeof import("../../src/app/api/pages/[id]/links/route");
  tags: typeof import("../../src/app/api/tags/route");
  graph: typeof import("../../src/app/api/graph/route");
  inbox: typeof import("../../src/app/api/inbox/route");
  inboxItem: typeof import("../../src/app/api/inbox/[id]/route");
  attachments: typeof import("../../src/app/api/attachments/route");
  attachment: typeof import("../../src/app/api/attachments/[id]/route");
  orphans: typeof import("../../src/app/api/attachments/orphans/route");
  databases: typeof import("../../src/app/api/databases/route");
  database: typeof import("../../src/app/api/databases/[id]/route");
  properties: typeof import("../../src/app/api/databases/[id]/properties/route");
  templates: typeof import("../../src/app/api/databases/[id]/templates/route");
  template: typeof import("../../src/app/api/databases/[id]/templates/[templateId]/route");
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
    inbox,
    inboxItem,
    attachments,
    attachment,
    orphans,
    databases,
    database,
    properties,
    templates,
    template,
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
    import("../../src/app/api/inbox/route"),
    import("../../src/app/api/inbox/[id]/route"),
    import("../../src/app/api/attachments/route"),
    import("../../src/app/api/attachments/[id]/route"),
    import("../../src/app/api/attachments/orphans/route"),
    import("../../src/app/api/databases/route"),
    import("../../src/app/api/databases/[id]/route"),
    import("../../src/app/api/databases/[id]/properties/route"),
    import("../../src/app/api/databases/[id]/templates/route"),
    import("../../src/app/api/databases/[id]/templates/[templateId]/route"),
  ]);

  api = { pages, page, move, reorder, revisions, pageTags, links, tags, graph, inbox, inboxItem, attachments, attachment, orphans, databases, database, properties, templates, template };
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

    const scan = await body<{ count: number; items: { id: string }[] }>(await api.orphans.GET());
    assert.ok(scan.items.some((item) => item.id === orphan.id), "unreferenced files should be reported");
    assert.ok(!scan.items.some((item) => item.id === kept.id), "a page cover should protect its file");

    const clean = await body<{ removed: number }>(await api.orphans.DELETE());
    assert.ok(clean.removed >= 1);

    const afterCleanup = await body<{ items: { id: string }[] }>(await api.orphans.GET());
    assert.ok(!afterCleanup.items.some((item) => item.id === orphan.id));
    assert.equal(
      (await api.attachment.GET(jsonRequest(kept.url, "GET"), routeContext({ id: kept.id }))).status,
      200,
      "referenced files must survive cleanup",
    );
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

  it("derives a title from the source URL host", async () => {
    const response = await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
      sourceUrl: "https://example.com/read-later",
    }));

    assert.equal(response.status, 201);
    const item = await body<PageRow & { sourceUrl: string }>(response);
    assert.equal(item.title, "example.com");
    assert.equal(item.sourceUrl, "https://example.com/read-later");
  });

  it("lists inbox items only and removes them when organized", async () => {
    const captured = await body<PageRow>(await api.inbox.POST(jsonRequest("/api/inbox", "POST", {
      title: "Organize me",
      content: "Some notes",
    })));
    const normal = await createPage({ title: "Regular page" });

    const beforeList = await body<PageRow[]>(await api.inbox.GET());
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
      await api.graph.GET(),
    );
    assert.ok(graph.nodes.some((node) => node.id === parent.id));
    assert.ok(graph.nodes.some((node) => node.id === child.id));
    assert.ok(graph.edges.some((edge) =>
      edge.source === parent.id && edge.target === child.id && edge.type === "hierarchy"));
    assert.ok(graph.edges.some((edge) =>
      edge.source === source.id && edge.target === target.id && edge.type === "link"),
      "explicit page links become graph edges");

    await api.page.DELETE(jsonRequest(`/api/pages/${child.id}`, "DELETE"), routeContext({ id: child.id }));
    const afterTrash = await body<{ nodes: { id: string }[]; edges: { target: string }[] }>(await api.graph.GET());
    assert.ok(!afterTrash.nodes.some((node) => node.id === child.id), "trashed pages leave the graph");
    assert.ok(!afterTrash.edges.some((edge) => edge.target === child.id));

    await api.page.DELETE(jsonRequest(`/api/pages/${target.id}`, "DELETE"), routeContext({ id: target.id }));
    const afterTargetTrash = await body<{ edges: { target: string }[] }>(await api.graph.GET());
    assert.ok(!afterTargetTrash.edges.some((edge) => edge.target === target.id),
      "links to trashed pages are hidden");
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
    const tags = await body<TagRow[]>(await api.tags.GET());
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
});
