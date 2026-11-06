import assert from "node:assert/strict";
import test from "node:test";
import { markdownFileToPage } from "../src/lib/markdown-import";

type Node = Record<string, unknown>;

function marksOf(node: Node | undefined) {
  return ((node?.marks ?? []) as Node[]).map((mark) => ({
    type: mark.type,
    href: (mark.attrs as Record<string, unknown> | undefined)?.href,
  }));
}

test("Markdown import turns fenced code into a code block with its language", () => {
  const page = markdownFileToPage("```ts\nconst a = 1;\n```\n\nDone", "Snippet.md");

  assert.equal(page.title, "Snippet");
  assert.equal(page.content, "const a = 1;\nDone");
  assert.deepEqual(page.contentJson.content?.[0], {
    type: "codeBlock",
    attrs: { language: "ts" },
    content: [{ type: "text", text: "const a = 1;" }],
  });
  assert.equal((page.contentJson.content?.[1] as Node).type, "paragraph");
});

test("Markdown import keeps an unclosed fence as a code block instead of throwing", () => {
  const page = markdownFileToPage("```\nunterminated", "Fence.md");

  assert.deepEqual(page.contentJson.content?.[0], {
    type: "codeBlock",
    attrs: { language: null },
    content: [{ type: "text", text: "unterminated" }],
  });
});

test("Markdown import merges quote lines and recognizes horizontal rules", () => {
  const page = markdownFileToPage("> quoted one\n> quoted two\n\n---\n", "Quotes.md");

  assert.equal(page.content, "quoted one quoted two");
  assert.deepEqual(page.contentJson.content, [
    {
      type: "blockquote",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "quoted one quoted two" }],
      }],
    },
    { type: "horizontalRule" },
  ]);
});

test("Markdown import maps bold, italic, strike, code, and link marks", () => {
  const page = markdownFileToPage(
    "Use **bold** and *it* or _em_ plus ~~gone~~ and `code` and [link](https://x.test).",
    "Inline.md",
  );

  const nodes = (page.contentJson.content?.[0] as Node).content as Node[];
  const byText = new Map(nodes.map((node) => [node.text, marksOf(node)]));

  assert.deepEqual(byText.get("bold"), [{ type: "bold", href: undefined }]);
  assert.deepEqual(byText.get("it"), [{ type: "italic", href: undefined }]);
  assert.deepEqual(byText.get("em"), [{ type: "italic", href: undefined }]);
  assert.deepEqual(byText.get("gone"), [{ type: "strike", href: undefined }]);
  assert.deepEqual(byText.get("code"), [{ type: "code", href: undefined }]);
  assert.deepEqual(byText.get("link"), [{ type: "link", href: "https://x.test" }]);
  assert.equal(page.content, "Use bold and it or em plus gone and code and link.");
});

test("Markdown import strips a leading heading that repeats the title only", () => {
  const matching = markdownFileToPage("# Mine\n\nbody", "Mine.md");
  assert.equal(matching.content, "body");
  assert.deepEqual(matching.contentJson.content, [
    { type: "paragraph", content: [{ type: "text", text: "body" }] },
  ]);

  const differing = markdownFileToPage("# Other\n\nbody", "Mine.md");
  assert.equal(differing.title, "Mine");
  assert.equal(differing.content, "Other\nbody");
  assert.equal((differing.contentJson.content?.[0] as Node).type, "heading");
});

test("Markdown import joins wrapped paragraph lines and splits on blank lines", () => {
  const page = markdownFileToPage("one line\ntwo line\n\nnext para", "Para.md");

  assert.equal(page.content, "one line two line\nnext para");
  assert.equal(page.contentJson.content?.length, 2);
});

test("Markdown import splits ordered and bullet lists when the marker changes", () => {
  const page = markdownFileToPage("1. a\n2. b\n\n- x\n- y", "Lists.md");

  assert.deepEqual((page.contentJson.content ?? []).map((node) => (node as Node).type), [
    "orderedList",
    "bulletList",
  ]);
  assert.equal(page.content, "a\nb\nx\ny");
});

test("Markdown import normalizes CRLF line endings", () => {
  const page = markdownFileToPage("a\r\n\r\nb", "Crlf.md");

  assert.equal(page.content, "a\nb");
  assert.equal(page.contentJson.content?.length, 2);
});

test("Markdown import treats a hash without a space as plain text", () => {
  const page = markdownFileToPage("#nope\n\ntext", "Tags.md");

  assert.equal(page.content, "#nope\ntext");
  assert.deepEqual((page.contentJson.content ?? []).map((node) => (node as Node).type), [
    "paragraph",
    "paragraph",
  ]);
});

test("Markdown import derives titles from filenames", () => {
  assert.equal(markdownFileToPage("x", "my_page 1234abcd.md").title, "my page");
  assert.equal(markdownFileToPage("x", "Notes.markdown").title, "Notes");
  assert.equal(markdownFileToPage("x", "Weekly-Review.md").title, "Weekly Review");
});
