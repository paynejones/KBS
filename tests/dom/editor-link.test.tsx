import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorToolbar } from "../../src/components/editor-toolbar";
import { collectLinkedPageIds, diffLinkedPageIds } from "../../src/lib/page-link-sync";
import { restoreStrictFetch, stubStrictFetch } from "./strict-fetch-stub";

let editor: Editor;

type TiptapNode = {
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: TiptapNode[];
};

const CURRENT_PAGE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGES = [
  { id: "11111111-1111-4111-8111-111111111111", title: "Roadmap" },
  { id: "22222222-2222-4222-8222-222222222222", title: "Release notes" },
];

function findLinkMark(document: Record<string, unknown>, text: string) {
  let found: { type: string; attrs?: Record<string, unknown> } | undefined;
  const walk = (node: TiptapNode) => {
    if (node.text === text) found = node.marks?.find((mark) => mark.type === "link");
    for (const child of node.content ?? []) walk(child);
  };
  walk(document as TiptapNode);
  return found;
}

function stubFetch() {
  const calls = stubStrictFetch("EditorToolbar", (call) =>
    call.url === `/api/pages/${CURRENT_PAGE_ID}/links` &&
    (call.method === "POST" || call.method === "DELETE")
      ? ({ ok: true, status: 201 } as Response)
      : undefined,
  );

  return {
    get requests() {
      return calls.map((call) => ({
        url: call.url,
        method: call.method,
        body: call.body === null ? "" : JSON.stringify(call.body),
      }));
    },
    restore: restoreStrictFetch,
  };
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
  restoreStrictFetch();
});

test("the toolbar links the selected text", () => {
  editor.commands.setTextSelection({ from: 10, to: 14 });
  render(<EditorToolbar editor={editor} />);

  fireEvent.click(screen.getByRole("button", { name: /Link/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Link target" }), {
    target: { value: "example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add link" }));

  const mark = findLinkMark(editor.getJSON() as Record<string, unknown>, "docs");
  assert.equal(mark?.attrs?.href, "https://example.com/");
  assert.equal(screen.queryByRole("textbox", { name: "Link target" }), null, "the panel closes after applying");
});

test("the toolbar inserts the address when nothing is selected", () => {
  editor.commands.setTextSelection({ from: 19, to: 19 });
  render(<EditorToolbar editor={editor} />);

  fireEvent.click(screen.getByRole("button", { name: /Link/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Link target" }), {
    target: { value: "https://example.com/docs" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Link target" }), { key: "Enter" });

  const mark = findLinkMark(editor.getJSON() as Record<string, unknown>, "https://example.com/docs");
  assert.equal(mark?.attrs?.href, "https://example.com/docs");
});

test("the toolbar pre-fills an existing link and can remove it", () => {
  editor.commands.setTextSelection({ from: 10, to: 14 });
  editor.chain().setLink({ href: "https://already.example" }).run();
  render(<EditorToolbar editor={editor} />);

  fireEvent.click(screen.getByRole("button", { name: /Link/ }));
  const input = screen.getByRole("textbox", { name: "Link target" }) as HTMLInputElement;
  assert.equal(input.value, "https://already.example");

  fireEvent.click(screen.getByRole("button", { name: "Remove link" }));

  assert.equal(findLinkMark(editor.getJSON() as Record<string, unknown>, "docs"), undefined);
});

test("the toolbar rejects an unusable address instead of creating a link", () => {
  editor.commands.setTextSelection({ from: 10, to: 14 });
  render(<EditorToolbar editor={editor} />);

  fireEvent.click(screen.getByRole("button", { name: /Link/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Link target" }), {
    target: { value: "javascript:alert(1)" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add link" }));

  assert.equal(screen.getByRole("alert").textContent, "Enter a web address, for example https://example.com.");
  assert.equal(findLinkMark(editor.getJSON() as Record<string, unknown>, "docs"), undefined);
});

test("the toolbar links selected text to a page and records the connection", async () => {
  const fetchStub = stubFetch();
  try {
    editor.commands.setTextSelection({ from: 10, to: 14 });
    render(<EditorToolbar editor={editor} pageId={CURRENT_PAGE_ID} pages={PAGES} />);

    fireEvent.click(screen.getByRole("button", { name: /Link/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link target" }), {
      target: { value: "road" },
    });
    const option = screen.getByRole("option", { name: /Roadmap/ });
    await act(async () => {
      fireEvent.click(option);
    });

    const mark = findLinkMark(editor.getJSON() as Record<string, unknown>, "docs");
    assert.equal(mark?.attrs?.href, `/pages/${PAGES[0].id}`);
    assert.deepEqual(fetchStub.requests, [
      {
        url: `/api/pages/${CURRENT_PAGE_ID}/links`,
        method: "POST",
        body: JSON.stringify({ targetPageId: PAGES[0].id, origin: "inline" }),
      },
    ]);
    assert.equal(screen.queryByRole("textbox", { name: "Link target" }), null);
  } finally {
    fetchStub.restore();
  }
});

test("the toolbar inserts the page title when nothing is selected", async () => {
  const fetchStub = stubFetch();
  try {
    editor.commands.setTextSelection({ from: 19, to: 19 });
    render(<EditorToolbar editor={editor} pageId={CURRENT_PAGE_ID} pages={PAGES} />);

    fireEvent.click(screen.getByRole("button", { name: /Link/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link target" }), {
      target: { value: "release" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /Release notes/ }));
    });

    const mark = findLinkMark(editor.getJSON() as Record<string, unknown>, "Release notes");
    assert.equal(mark?.attrs?.href, `/pages/${PAGES[1].id}`);
  } finally {
    fetchStub.restore();
  }
});

test("the toolbar pre-fills a page link with its title", () => {
  editor.commands.setTextSelection({ from: 10, to: 14 });
  editor.chain().setLink({ href: `/pages/${PAGES[0].id}` }).run();
  render(<EditorToolbar editor={editor} pageId={CURRENT_PAGE_ID} pages={PAGES} />);

  fireEvent.click(screen.getByRole("button", { name: /Link/ }));
  const input = screen.getByRole("textbox", { name: "Link target" }) as HTMLInputElement;
  assert.equal(input.value, "Roadmap");
  assert.equal(screen.getByRole("button", { name: "Update link" }).textContent, "Update link");
});

test("the toolbar narrows page suggestions and links the highlighted one with the keyboard", async () => {
  const fetchStub = stubFetch();
  try {
    editor.commands.setTextSelection({ from: 10, to: 14 });
    render(<EditorToolbar editor={editor} pageId={CURRENT_PAGE_ID} pages={PAGES} />);

    fireEvent.click(screen.getByRole("button", { name: /Link/ }));
    const input = screen.getByRole("textbox", { name: "Link target" });

    fireEvent.change(input, { target: { value: "o" } });
    assert.equal(screen.getAllByRole("option").length, 2);

    fireEvent.change(input, { target: { value: "release" } });
    assert.deepEqual(
      screen.getAllByRole("option").map((option) => option.textContent),
      ["Release notesPage"],
    );

    fireEvent.change(input, { target: { value: "example.com" } });
    assert.equal(screen.queryByRole("listbox"), null, "a web address is not searched as a page title");

    fireEvent.change(input, { target: { value: "o" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    assert.equal(
      screen.getByRole("option", { name: /Release notes/ }).getAttribute("aria-selected"),
      "true",
    );

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    const mark = findLinkMark(editor.getJSON() as Record<string, unknown>, "docs");
    assert.equal(mark?.attrs?.href, `/pages/${PAGES[1].id}`);
  } finally {
    fetchStub.restore();
  }
});

test("the toolbar reports a page link that could not be saved", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;
  try {
    editor.commands.setTextSelection({ from: 10, to: 14 });
    render(<EditorToolbar editor={editor} pageId={CURRENT_PAGE_ID} pages={PAGES} />);

    fireEvent.click(screen.getByRole("button", { name: /Link/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link target" }), {
      target: { value: "road" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /Roadmap/ }));
    });

    assert.equal(screen.getByRole("alert").textContent, "The page link could not be saved.");
    assert.equal(findLinkMark(editor.getJSON() as Record<string, unknown>, "docs"), undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("removing a page link deletes its stale connection", async () => {
  const fetchStub = stubFetch();
  try {
    editor.commands.setTextSelection({ from: 10, to: 14 });
    editor.chain().setLink({ href: `/pages/${PAGES[0].id}` }).run();
    render(<EditorToolbar editor={editor} pageId={CURRENT_PAGE_ID} pages={PAGES} />);

    fireEvent.click(screen.getByRole("button", { name: /Link/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    });

    assert.deepEqual(fetchStub.requests, [
      {
        url: `/api/pages/${CURRENT_PAGE_ID}/links`,
        method: "DELETE",
        body: JSON.stringify({ targetPageId: PAGES[0].id, origin: "inline" }),
      },
    ]);
    assert.equal(findLinkMark(editor.getJSON() as Record<string, unknown>, "docs"), undefined);
  } finally {
    fetchStub.restore();
  }
});

test("removing one of two links to a page keeps the connection", async () => {
  const fetchStub = stubFetch();
  try {
    editor.commands.setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First", marks: [{ type: "link", attrs: { href: `/pages/${PAGES[0].id}` } }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Second", marks: [{ type: "link", attrs: { href: `/pages/${PAGES[0].id}` } }] }] },
      ],
    });
    editor.commands.setTextSelection({ from: 1, to: 6 });
    render(<EditorToolbar editor={editor} pageId={CURRENT_PAGE_ID} pages={PAGES} />);

    fireEvent.click(screen.getByRole("button", { name: /Link/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    });

    assert.deepEqual(fetchStub.requests, [], "the remaining inline link still justifies the connection");
    assert.equal(findLinkMark(editor.getJSON() as Record<string, unknown>, "First"), undefined);
    assert.equal(
      findLinkMark(editor.getJSON() as Record<string, unknown>, "Second")?.attrs?.href,
      `/pages/${PAGES[0].id}`,
    );
  } finally {
    fetchStub.restore();
  }
});

test("retargeting a page link deletes the previous connection", async () => {
  const fetchStub = stubFetch();
  try {
    editor.commands.setTextSelection({ from: 10, to: 14 });
    editor.chain().setLink({ href: `/pages/${PAGES[0].id}` }).run();
    render(<EditorToolbar editor={editor} pageId={CURRENT_PAGE_ID} pages={PAGES} />);

    fireEvent.click(screen.getByRole("button", { name: /Link/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link target" }), {
      target: { value: "release" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /Release notes/ }));
    });

    assert.deepEqual(fetchStub.requests, [
      {
        url: `/api/pages/${CURRENT_PAGE_ID}/links`,
        method: "POST",
        body: JSON.stringify({ targetPageId: PAGES[1].id, origin: "inline" }),
      },
      {
        url: `/api/pages/${CURRENT_PAGE_ID}/links`,
        method: "DELETE",
        body: JSON.stringify({ targetPageId: PAGES[0].id, origin: "inline" }),
      },
    ]);
    assert.equal(
      findLinkMark(editor.getJSON() as Record<string, unknown>, "docs")?.attrs?.href,
      `/pages/${PAGES[1].id}`,
    );
  } finally {
    fetchStub.restore();
  }
});

test("replacing a page link with a web address deletes the previous connection", async () => {
  const fetchStub = stubFetch();
  try {
    editor.commands.setTextSelection({ from: 10, to: 14 });
    editor.chain().setLink({ href: `/pages/${PAGES[0].id}` }).run();
    render(<EditorToolbar editor={editor} pageId={CURRENT_PAGE_ID} pages={PAGES} />);

    fireEvent.click(screen.getByRole("button", { name: /Link/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link target" }), {
      target: { value: "example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update link" }));
    });

    assert.deepEqual(fetchStub.requests, [
      {
        url: `/api/pages/${CURRENT_PAGE_ID}/links`,
        method: "DELETE",
        body: JSON.stringify({ targetPageId: PAGES[0].id, origin: "inline" }),
      },
    ]);
    assert.equal(
      findLinkMark(editor.getJSON() as Record<string, unknown>, "docs")?.attrs?.href,
      "https://example.com/",
    );
  } finally {
    fetchStub.restore();
  }
});

test("linked page ids follow link text through deletion and undo", () => {
  const linked = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit.configure({ link: { openOnClick: false } })],
    content: `<p><a href="/pages/${PAGES[0].id}">Roadmap</a> and <a href="/pages/${PAGES[1].id}">Notes</a></p>`,
  });

  try {
    const before = collectLinkedPageIds(linked.state.doc);
    assert.deepEqual([...before].sort(), [PAGES[0].id, PAGES[1].id].sort());

    // Deleting the first link's text is an ordinary editor update, not a
    // link-panel edit, and must still release that page's connection.
    linked.chain().setTextSelection({ from: 1, to: 8 }).deleteSelection().run();
    const afterDelete = collectLinkedPageIds(linked.state.doc);
    assert.deepEqual([...afterDelete], [PAGES[1].id], "only the deleted link's page goes away");
    assert.deepEqual(
      diffLinkedPageIds(before, afterDelete),
      { added: [], removed: [PAGES[0].id] },
      "the editor sees exactly the connection whose link text is gone",
    );

    linked.commands.undo();
    const afterUndo = collectLinkedPageIds(linked.state.doc);
    assert.deepEqual(
      diffLinkedPageIds(afterDelete, afterUndo),
      { added: [PAGES[0].id], removed: [] },
      "undoing the deletion brings the link back",
    );
  } finally {
    linked.destroy();
  }
});
