import assert from "node:assert/strict";
import test from "node:test";
import { markdownFileToPage } from "../src/lib/markdown-import";
import { tiptapToMarkdown } from "../src/lib/markdown";
import { readRecoverablePageDraft } from "../src/lib/page-draft";
import { validateDatabaseRecordValues } from "../src/lib/database-values";

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
});
