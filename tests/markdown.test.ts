import assert from "node:assert/strict";
import test from "node:test";
import { tiptapToMarkdown } from "../src/lib/markdown";

type Node = Record<string, unknown>;

function doc(...content: Node[]): Node {
  return { type: "doc", content };
}

function text(value: string, ...marks: Node[]): Node {
  return marks.length ? { type: "text", text: value, marks } : { type: "text", text: value };
}

function paragraph(...content: Node[]): Node {
  return { type: "paragraph", content };
}

function cell(value: string): Node {
  return { type: "tableCell", content: [paragraph(text(value))] };
}

test("markdown export writes tables with a header row, separators, and escaped pipes", () => {
  const markdown = tiptapToMarkdown(doc({
    type: "table",
    content: [
      { type: "tableRow", content: [cell("Name"), cell("Pipe | value")] },
      { type: "tableRow", content: [cell("One")] },
    ],
  }));

  assert.equal(markdown, "| Name | Pipe \\| value |\n| --- | --- |\n| One |  |");
});

test("markdown export skips tables without rows", () => {
  assert.equal(tiptapToMarkdown(doc({ type: "table", content: [] })), "");
});

test("markdown export prefixes every line of a blockquote", () => {
  const markdown = tiptapToMarkdown(doc({
    type: "blockquote",
    content: [paragraph(text("first")), paragraph(text("second"))],
  }));

  assert.equal(markdown, "> first\n> \n> second");
});

test("markdown export fences code blocks and keeps their language", () => {
  const markdown = tiptapToMarkdown(doc(
    { type: "codeBlock", attrs: { language: "ts" }, content: [text("const a = 1;\nconst b = 2;")] },
    { type: "codeBlock", attrs: {}, content: [text("plain")] },
  ));

  assert.equal(markdown, "```ts\nconst a = 1;\nconst b = 2;\n```\n\n```\nplain\n```");
});

test("markdown export renders images with encoded sources and escaped alt text", () => {
  assert.equal(
    tiptapToMarkdown(doc({ type: "imageEmbed", attrs: { src: "/api/attachments/abc file.png", alt: "a [b]" } })),
    "![a [b\\]](/api/attachments/abc%20file.png)",
  );
});

test("markdown export drops images without a source", () => {
  assert.equal(tiptapToMarkdown(doc({ type: "imageEmbed", attrs: { alt: "missing" } })), "");
  assert.equal(tiptapToMarkdown(doc({ type: "imageEmbed" })), "");
});

test("markdown export renders horizontal rules and database embeds", () => {
  assert.equal(tiptapToMarkdown(doc({ type: "horizontalRule" })), "---");
  assert.equal(
    tiptapToMarkdown(doc({ type: "databaseEmbed", attrs: { databaseId: "db-1" } })).trim(),
    "> Embedded database: db-1",
  );
});

test("markdown export indents nested lists", () => {
  const markdown = tiptapToMarkdown(doc({
    type: "bulletList",
    content: [{
      type: "listItem",
      content: [
        paragraph(text("parent")),
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [paragraph(text("child"))] }],
        },
      ],
    }],
  }));

  assert.equal(markdown, "- parent\n    - child");
});

test("markdown export honors an ordered list start and marker sequence", () => {
  const markdown = tiptapToMarkdown(doc({
    type: "orderedList",
    attrs: { start: 3 },
    content: [
      { type: "listItem", content: [paragraph(text("three"))] },
      { type: "listItem", content: [paragraph(text("four"))] },
    ],
  }));

  assert.equal(markdown, "3. three\n4. four");
});

test("markdown export clamps heading levels to the supported range", () => {
  const markdown = tiptapToMarkdown(doc(
    { type: "heading", attrs: { level: 12 }, content: [text("deep")] },
    { type: "heading", attrs: {}, content: [text("default")] },
  ));

  assert.equal(markdown, "###### deep\n\n# default");
});

test("markdown export renders inline marks and hard breaks", () => {
  const markdown = tiptapToMarkdown(doc(paragraph(
    text("bold", { type: "bold" }),
    text(" "),
    text("italic", { type: "italic" }),
    text(" "),
    text("strike", { type: "strike" }),
    text(" "),
    text("code", { type: "code" }),
    { type: "hardBreak" },
    text("after"),
  )));

  assert.equal(markdown, "**bold** _italic_ ~~strike~~ `code`  \nafter");
});

test("markdown export unwraps unknown blocks instead of losing their text", () => {
  assert.equal(
    tiptapToMarkdown(doc({ type: "customBlock", content: [paragraph(text("inner"))] })),
    "inner",
  );
});

test("markdown export tolerates empty documents", () => {
  assert.equal(tiptapToMarkdown({ type: "doc" }), "");
  assert.equal(tiptapToMarkdown({}), "");
});
