import assert from "node:assert/strict";
import test from "node:test";
import { markdownFileToPage } from "../src/lib/markdown-import";
import { tiptapToMarkdown } from "../src/lib/markdown";
import { readRecoverablePageDraft } from "../src/lib/page-draft";
import { referencedAttachmentIds, validateDatabaseRecordValues } from "../src/lib/database-values";

test("Markdown import derives a readable title and preserves common formatting", () => {
  const page = markdownFileToPage(
    "# Project Notes\n\nA **bold** idea.\n\n- First\n- Second\n",
    "Project_Notes.md",
  );

  assert.equal(page.title, "Project Notes");
  assert.equal(page.content, "A bold idea.\nFirst\nSecond");
  assert.equal(page.contentJson.type, "doc");
  assert.equal(page.contentJson.content?.length, 2);
});

test("Markdown import safely returns an empty editable document", () => {
  const page = markdownFileToPage("  \n", "---.markdown");

  assert.equal(page.title, "Imported page");
  assert.equal(page.content, "");
  assert.deepEqual(page.contentJson, {
    type: "doc",
    content: [{ type: "paragraph" }],
  });
});

test("Markdown export renders headings, links, and ordered lists", () => {
  const markdown = tiptapToMarkdown({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Plan" }] },
      { type: "paragraph", content: [{ type: "text", text: "Docs", marks: [{ type: "link", attrs: { href: "https://example.com/a b" } }] }] },
      { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] }] },
    ],
  });

  assert.equal(markdown, "## Plan\n\n[Docs](https://example.com/a%20b)\n\n1. First");
});

test("draft recovery accepts a newer valid local edit", () => {
  const draft = {
    content: "unsaved change",
    contentJson: { type: "doc", content: [] },
    revision: 4,
    savedAt: 2_000,
  };

  assert.deepEqual(readRecoverablePageDraft(JSON.stringify(draft), new Date(1_000)), draft);
});

test("draft recovery ignores malformed, stale, and structurally invalid drafts", () => {
  assert.equal(readRecoverablePageDraft("not json", new Date(1_000)), null);
  assert.equal(readRecoverablePageDraft(null, new Date(1_000)), null);
  assert.equal(readRecoverablePageDraft(JSON.stringify({ content: "x" }), new Date(1_000)), null);
  assert.equal(readRecoverablePageDraft(JSON.stringify({
    content: "old edit",
    contentJson: { type: "doc" },
    revision: 1,
    savedAt: 1_000,
  }), new Date(1_000)), null);
});

test("database values must match property types and configured choices", () => {
  const properties = [
    { id: "text", name: "Notes", type: "text", options: {} },
    { id: "number", name: "Score", type: "number", options: {} },
    { id: "checkbox", name: "Done", type: "checkbox", options: {} },
    { id: "select", name: "Status", type: "select", options: { choices: ["Todo", "Done"] } },
    { id: "multi", name: "Labels", type: "multi_select", options: { choices: ["Home", "Work"] } },
    { id: "rollup", name: "Total", type: "rollup", options: {} },
    { id: "formula", name: "Progress", type: "formula", options: {} },
  ];

  assert.equal(validateDatabaseRecordValues({
    text: "memo",
    number: 4.5,
    checkbox: false,
    select: "Todo",
    multi: ["Home", "Work"],
  }, properties), null);
  assert.match(validateDatabaseRecordValues({ missing: "value" }, properties) ?? "", /does not belong/);
  assert.match(validateDatabaseRecordValues({ number: "4" }, properties) ?? "", /finite number/);
  assert.match(validateDatabaseRecordValues({ select: "Unknown" }, properties) ?? "", /configured choices/);
  assert.match(validateDatabaseRecordValues({ rollup: 10 }, properties) ?? "", /managed/);
  assert.match(validateDatabaseRecordValues({ formula: 10 }, properties) ?? "", /calculated/);
});

test("database values validate file properties and null values", () => {
  const properties = [
    { id: "file", name: "Cover", type: "file", options: {} },
    { id: "date", name: "Due", type: "date", options: {} },
  ];
  const attachment = "11111111-1111-4111-8111-111111111111";

  assert.equal(validateDatabaseRecordValues({ date: null, file: null }, properties), null);
  assert.equal(validateDatabaseRecordValues({
    file: {
      url: `/api/attachments/${attachment}`,
      attachmentId: attachment,
      alt: "",
      filename: "a.png",
      mimeType: "image/png",
    },
  }, properties), null);
  assert.match(validateDatabaseRecordValues({ file: "a.png" }, properties) ?? "", /uploaded file/);
  assert.match(validateDatabaseRecordValues({ file: { url: "javascript:alert(1)" } }, properties) ?? "", /uploaded file/);
  assert.match(validateDatabaseRecordValues({ date: 7 }, properties) ?? "", /must be text/);
});

test("database values reject values for managed property types", () => {
  const properties = [
    { id: "relation", name: "Related", type: "relation", options: {} },
    { id: "multi", name: "Labels", type: "multi_select", options: { choices: ["Home"] } },
    { id: "checkbox", name: "Done", type: "checkbox", options: {} },
  ];

  assert.match(validateDatabaseRecordValues({ relation: [] }, properties) ?? "", /managed/);
  assert.match(validateDatabaseRecordValues({ multi: "Home" }, properties) ?? "", /configured choices/);
  assert.match(validateDatabaseRecordValues({ multi: ["Unknown"] }, properties) ?? "", /configured choices/);
  assert.match(validateDatabaseRecordValues({ checkbox: "yes" }, properties) ?? "", /checked or unchecked/);
  assert.equal(validateDatabaseRecordValues({}, properties), null);
});

test("database file values report the attachment they reference", () => {
  const attachment = "11111111-1111-4111-8111-111111111111";
  const properties = [
    { id: "file", name: "Cover", type: "file", options: {} },
    { id: "text", name: "Notes", type: "text", options: {} },
  ];

  assert.deepEqual(referencedAttachmentIds({
    file: { url: `/api/attachments/${attachment}`, attachmentId: attachment },
  }, properties), [attachment]);
  assert.deepEqual(referencedAttachmentIds({
    file: { url: "https://example.com/cover.png", attachmentId: null },
  }, properties), [], "remote media has no stored attachment to clean up");
  assert.deepEqual(referencedAttachmentIds({
    text: `/api/attachments/${attachment}`,
    file: null,
  }, properties), [], "only file properties own attachments");
  assert.deepEqual(referencedAttachmentIds({}, properties), []);
});

test("draft recovery rejects impossible revisions and boundary timestamps", () => {
  const base = { content: "text", contentJson: { type: "doc" }, revision: 1, savedAt: 2_000 };

  assert.equal(readRecoverablePageDraft(JSON.stringify({ ...base, revision: 0 }), new Date(1_000)), null);
  assert.equal(readRecoverablePageDraft(JSON.stringify({ ...base, revision: 1.5 }), new Date(1_000)), null);
  assert.equal(readRecoverablePageDraft(JSON.stringify(base), new Date(2_000)), null,
    "a draft must be newer than the server copy");
  assert.equal(readRecoverablePageDraft(JSON.stringify({ ...base, contentJson: [] }), new Date(1_000)), null);
  assert.equal(readRecoverablePageDraft(JSON.stringify({ ...base, contentJson: { type: "paragraph" } }), new Date(1_000)), null);
  assert.deepEqual(
    readRecoverablePageDraft(JSON.stringify(base), "1970-01-01T00:00:01.000Z"),
    base,
    "an ISO server timestamp is accepted too",
  );
});
