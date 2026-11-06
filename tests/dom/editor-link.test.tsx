import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorToolbar } from "../../src/components/editor-toolbar";

let editor: Editor;

type TiptapNode = {
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: TiptapNode[];
};

function findLinkMark(document: Record<string, unknown>, text: string) {
  let found: { type: string; attrs?: Record<string, unknown> } | undefined;
  const walk = (node: TiptapNode) => {
    if (node.text === text) found = node.marks?.find((mark) => mark.type === "link");
    for (const child of node.content ?? []) walk(child);
  };
  walk(document as TiptapNode);
  return found;
}

beforeEach(() => {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit.configure({ link: { openOnClick: false } })],
    content: "<p>Read the docs here</p>",
  });
});

afterEach(() => {
  cleanup();
  editor.destroy();
});

test("the toolbar links the selected text", () => {
  editor.commands.setTextSelection({ from: 10, to: 14 });
  render(<EditorToolbar editor={editor} />);

  fireEvent.click(screen.getByRole("button", { name: /Link/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Link URL" }), {
    target: { value: "example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add link" }));

  const mark = findLinkMark(editor.getJSON() as Record<string, unknown>, "docs");
  assert.equal(mark?.attrs?.href, "https://example.com/");
  assert.equal(screen.queryByRole("textbox", { name: "Link URL" }), null, "the panel closes after applying");
});

test("the toolbar inserts the address when nothing is selected", () => {
  editor.commands.setTextSelection({ from: 19, to: 19 });
  render(<EditorToolbar editor={editor} />);

  fireEvent.click(screen.getByRole("button", { name: /Link/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Link URL" }), {
    target: { value: "https://example.com/docs" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Link URL" }), { key: "Enter" });

  const mark = findLinkMark(editor.getJSON() as Record<string, unknown>, "https://example.com/docs");
  assert.equal(mark?.attrs?.href, "https://example.com/docs");
});

test("the toolbar pre-fills an existing link and can remove it", () => {
  editor.commands.setTextSelection({ from: 10, to: 14 });
  editor.chain().setLink({ href: "https://already.example" }).run();
  render(<EditorToolbar editor={editor} />);

  fireEvent.click(screen.getByRole("button", { name: /Link/ }));
  const input = screen.getByRole("textbox", { name: "Link URL" }) as HTMLInputElement;
  assert.equal(input.value, "https://already.example");

  fireEvent.click(screen.getByRole("button", { name: "Remove link" }));

  assert.equal(findLinkMark(editor.getJSON() as Record<string, unknown>, "docs"), undefined);
});

test("the toolbar rejects an unusable address instead of creating a link", () => {
  editor.commands.setTextSelection({ from: 10, to: 14 });
  render(<EditorToolbar editor={editor} />);

  fireEvent.click(screen.getByRole("button", { name: /Link/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Link URL" }), {
    target: { value: "javascript:alert(1)" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add link" }));

  assert.equal(screen.getByRole("alert").textContent, "Enter a web address, for example https://example.com.");
  assert.equal(findLinkMark(editor.getJSON() as Record<string, unknown>, "docs"), undefined);
});
