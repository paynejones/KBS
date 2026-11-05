import assert from "node:assert/strict";
import test from "node:test";
import { backlinkContexts, linkHrefTargetsPage } from "../src/lib/backlinks";

const TARGET = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

type Node = Record<string, unknown>;

function text(value: string, pageId?: string): Node {
  return pageId
    ? {
        type: "text",
        text: value,
        marks: [{ type: "link", attrs: { href: `/pages/${pageId}` } }],
      }
    : { type: "text", text: value };
}

function paragraph(...content: (Node | string)[]): Node {
  return {
    type: "paragraph",
    content: content.map((child) => (typeof child === "string" ? text(child) : child)),
  };
}

function doc(...children: Node[]): Node {
  return { type: "doc", content: children };
}

test("backlink context quotes the sentence around an inline page link", () => {
  const content = doc(
    paragraph("Reading notes about ", text("the harvest plan", TARGET), " for autumn."),
  );

  const contexts = backlinkContexts(content, TARGET);
  assert.equal(contexts.length, 1);
  assert.match(contexts[0], /Reading notes about the harvest plan for autumn\./);
});

test("backlink context ignores links to other pages", () => {
  const content = doc(
    paragraph("See ", text("another page", OTHER), " instead."),
    paragraph("Plain text with no links."),
  );

  assert.deepEqual(backlinkContexts(content, TARGET), []);
});

test("backlink context keeps one snippet per block and respects the limit", () => {
  const content = doc(
    paragraph("First mention of ", text("target", TARGET)),
    paragraph("Second mention of ", text("target", TARGET)),
    paragraph("Third mention of ", text("target", TARGET)),
    paragraph("Fourth mention of ", text("target", TARGET)),
  );

  const contexts = backlinkContexts(content, TARGET);
  assert.equal(contexts.length, 3);
  assert.match(contexts[0], /First mention/);
  assert.match(contexts[2], /Third mention/);
});

test("backlink context truncates long paragraphs around the link", () => {
  const before = "a".repeat(400);
  const after = "b".repeat(400);
  const contexts = backlinkContexts(
    doc(paragraph(before, text("target", TARGET), after)),
    TARGET,
  );

  assert.equal(contexts.length, 1);
  assert.ok(contexts[0].startsWith("…"), "leading ellipsis should mark truncated text");
  assert.ok(contexts[0].endsWith("…"), "trailing ellipsis should mark truncated text");
  assert.ok(contexts[0].includes("target"));
  assert.ok(contexts[0].length < 200, "snippets should stay short enough to scan");
});

test("backlink context finds links inside lists, tables, and marked text", () => {
  const content = doc(
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [paragraph("Nested ", text("target", TARGET), " in a list")],
        },
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [paragraph("Cell mention of ", text("target", TARGET))],
            },
          ],
        },
      ],
    },
    paragraph({
      type: "text",
      text: "bold target",
      marks: [
        { type: "bold" },
        { type: "link", attrs: { href: `/pages/${TARGET}` } },
      ],
    }),
  );

  const contexts = backlinkContexts(content, TARGET);
  assert.equal(contexts.length, 3);
  assert.match(contexts[0], /Nested target in a list/);
  assert.match(contexts[1], /Cell mention of target/);
  assert.match(contexts[2], /bold target/);
});

test("link targets match paths, absolute URLs, and trailing slashes only for that page", () => {
  assert.equal(linkHrefTargetsPage(`/pages/${TARGET}`, TARGET), true);
  assert.equal(linkHrefTargetsPage(`https://kbs.example.com/pages/${TARGET}/`, TARGET), true);
  assert.equal(linkHrefTargetsPage(`/pages/${TARGET}?tab=notes`, TARGET), true);
  assert.equal(linkHrefTargetsPage(`/pages/${OTHER}`, TARGET), false);
  assert.equal(linkHrefTargetsPage(`/pages/${TARGET}-extra`, TARGET), false);
  assert.equal(linkHrefTargetsPage("https://example.com/page", TARGET), false);
  assert.equal(linkHrefTargetsPage(undefined, TARGET), false);
});

test("backlink context tolerates missing or malformed content", () => {
  assert.deepEqual(backlinkContexts(null, TARGET), []);
  assert.deepEqual(backlinkContexts({}, TARGET), []);
  assert.deepEqual(backlinkContexts("not content", TARGET), []);
});
