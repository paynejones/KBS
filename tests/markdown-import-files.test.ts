import assert from "node:assert/strict";
import { test } from "node:test";
import { importMarkdownFiles, importMarkdownFolder } from "../src/lib/markdown-import-files";

type StubNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: StubNode[];
};

type StubBody = {
  title?: string;
  content?: string;
  parentId?: string | null;
  contentJson?: StubNode;
};

function stubFetch(respond: (url: string, init?: RequestInit) => Response) {
  const original = globalThis.fetch;
  const requests: { url: string; body: StubBody }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body;
    requests.push({ url: String(input), body: typeof raw === "string" ? JSON.parse(raw) : {} });
    return respond(String(input), init);
  }) as typeof fetch;
  return { requests, restore: () => { globalThis.fetch = original; } };
}

test("Markdown import creates a page per supported file and names failed files", async () => {
  const { requests, restore } = stubFetch(() => new Response(JSON.stringify({ id: "page" }), { status: 201 }));
  try {
    const result = await importMarkdownFiles([
      new File(["# Note\n\nbody"], "Note.md", { type: "text/markdown" }),
      new File(["binary"], "photo.png"),
    ]);

    assert.equal(result.imported, 1);
    assert.deepEqual(result.failures, [{ name: "photo.png", reason: "unsupported file type" }]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/pages");
    assert.equal(requests[0].body.title, "Note");
    assert.equal(requests[0].body.content, "body");
  } finally {
    restore();
  }
});

test("Markdown import reports a file the server rejects", async () => {
  const { restore } = stubFetch(() => new Response(JSON.stringify({ error: "nope" }), { status: 500 }));
  try {
    const result = await importMarkdownFiles([new File(["body"], "Rejected.markdown")]);
    assert.equal(result.imported, 0);
    assert.deepEqual(result.failures, [{ name: "Rejected.markdown", reason: "import failed" }]);
  } finally {
    restore();
  }
});

function folderFile(path: string, body = "body") {
  const file = new File([body], path.split("/").pop() ?? path, { type: "text/markdown" });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

test("folder import recreates the directory tree as nested pages", async () => {
  let next = 0;
  const { requests, restore } = stubFetch(() =>
    new Response(JSON.stringify({ id: `page-${(next += 1)}` }), { status: 201 })
  );
  try {
    const result = await importMarkdownFolder([
      folderFile("Notes/Plan.md"),
      folderFile("Notes/Projects/Alpha.md"),
      new File(["binary"], "photo.png"),
    ]);

    assert.equal(result.imported, 2);
    assert.deepEqual(result.failures, [{ name: "photo.png", reason: "unsupported file type" }]);
    assert.deepEqual(
      requests.map((request) => [request.body.title, request.body.parentId]),
      [
        ["Notes", null],
        ["Projects", "page-1"],
        ["Plan", "page-1"],
        ["Alpha", "page-2"],
      ],
    );
  } finally {
    restore();
  }
});

test("folder import uploads embedded images and reports missing ones", async () => {
  const ATTACHMENT = "11111111-1111-4111-8111-111111111111";
  let pageId = 0;
  const { requests, restore } = stubFetch((url) =>
    url === "/api/attachments"
      ? Response.json({ id: ATTACHMENT, url: `/api/attachments/${ATTACHMENT}` }, { status: 201 })
      : Response.json({ id: `page-${(pageId += 1)}` }, { status: 201 })
  );
  const image = new File([new Uint8Array([1, 2, 3])], "chart.png", { type: "image/png" });
  Object.defineProperty(image, "webkitRelativePath", { value: "Notes/images/chart.png" });
  try {
    const result = await importMarkdownFolder([
      folderFile("Notes/Plan.md", "![Chart](images/chart.png)"),
      folderFile("Notes/Other.md", "![Gone](missing.png)"),
      image,
    ]);

    assert.equal(result.imported, 2);
    assert.deepEqual(result.failures, [{ name: "Other.md", reason: "image not found: missing.png" }]);

    const pageRequests = requests.filter((request) => request.url === "/api/pages");
    const plan = pageRequests.find((request) => request.body.title === "Plan");
    assert.ok(plan);
    assert.deepEqual(plan.body.contentJson?.content?.[0], {
      type: "imageEmbed",
      attrs: { src: `/api/attachments/${ATTACHMENT}`, alt: "Chart" },
    });
    assert.equal(requests.filter((request) => request.url === "/api/attachments").length, 1);
  } finally {
    restore();
  }
});

test("folder import uploads linked documents beyond PDFs", async () => {
  const ATTACHMENT = "33333333-3333-4333-8333-333333333333";
  let pageId = 0;
  const { requests, restore } = stubFetch((url) =>
    url === "/api/attachments"
      ? Response.json({ id: ATTACHMENT, url: `/api/attachments/${ATTACHMENT}` }, { status: 201 })
      : Response.json({ id: `page-${(pageId += 1)}` }, { status: 201 })
  );
  const data = new File(["a,b"], "data.csv", { type: "text/csv" });
  Object.defineProperty(data, "webkitRelativePath", { value: "Notes/files/data.csv" });
  try {
    const result = await importMarkdownFolder([
      folderFile("Notes/Plan.md", "Open [the data](files/data.csv)."),
      data,
    ]);

    assert.equal(result.imported, 1);
    assert.deepEqual(result.failures, []);
    const plan = requests.find((request) => request.body.title === "Plan");
    assert.ok(plan);
    const paragraph = plan.body.contentJson?.content?.[0];
    const link = paragraph?.content?.find((node) => node.text === "the data");
    assert.deepEqual(link?.marks, [{ type: "link", attrs: { href: `/api/attachments/${ATTACHMENT}` } }]);
    assert.equal(requests.filter((request) => request.url === "/api/attachments").length, 1);
  } finally {
    restore();
  }
});

test("folder import uploads linked PDFs and rewrites their hrefs", async () => {
  const ATTACHMENT = "22222222-2222-4222-8222-222222222222";
  let pageId = 0;
  const { requests, restore } = stubFetch((url) =>
    url === "/api/attachments"
      ? Response.json({ id: ATTACHMENT, url: `/api/attachments/${ATTACHMENT}` }, { status: 201 })
      : Response.json({ id: `page-${(pageId += 1)}` }, { status: 201 })
  );
  const pdf = new File([new Uint8Array([37, 80, 68, 70])], "report.pdf", { type: "application/pdf" });
  Object.defineProperty(pdf, "webkitRelativePath", { value: "Notes/files/report.pdf" });
  try {
    const result = await importMarkdownFolder([
      folderFile("Notes/Plan.md", "Read [the report](files/report.pdf) first."),
      pdf,
    ]);

    assert.equal(result.imported, 1);
    assert.deepEqual(result.failures, []);
    const plan = requests.find((request) => request.body.title === "Plan");
    assert.ok(plan);
    const paragraph = plan.body.contentJson?.content?.[0];
    const link = paragraph?.content?.find((node) => node.text === "the report");
    assert.deepEqual(link?.marks, [{ type: "link", attrs: { href: `/api/attachments/${ATTACHMENT}` } }]);
    assert.equal(requests.filter((request) => request.url === "/api/attachments").length, 1);
  } finally {
    restore();
  }
});
