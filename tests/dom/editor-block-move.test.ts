import "../setup-dom";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import {
  TableCellExtension,
  TableExtension,
  TableHeaderExtension,
  TableRowExtension,
} from "@/components/table-extension";
import { moveBlockAtSelection, selectedBlockGroup } from "@/lib/editor-block-move";
import { buildBlockDragImage } from "@/lib/editor-drag-image";

const schema = getSchema([
  StarterKit,
  TableExtension,
  TableRowExtension,
  TableHeaderExtension,
  TableCellExtension,
]);

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function stateWithSelection(content: Record<string, unknown>[], cursor: number) {
  const doc = schema.nodeFromJSON({ type: "doc", content });
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, cursor) });
}

function textsOf(doc: EditorState["doc"]): string[] {
  const texts: string[] = [];
  doc.descendants((node) => {
    if (node.isTextblock) texts.push(node.textContent);
    return node.isTextblock ? false : true;
  });
  return texts;
}

test("moves a paragraph down and keeps the caret offset inside it", () => {
  // "Alpha" starts at 1, so cursor 3 sits two characters in.
  const state = stateWithSelection([paragraph("Alpha"), paragraph("Beta")], 3);
  const transaction = moveBlockAtSelection(state, 1);
  assert.ok(transaction);

  const next = state.apply(transaction);
  assert.deepEqual(textsOf(next.doc), ["Beta", "Alpha"]);
  // "Beta" is a six-wide block, so the same two-character offset lands on 9.
  assert.equal(next.selection.from, 9);
  assert.equal(next.selection.$from.parent.textContent, "Alpha");
});

test("moves a list item inside its list instead of refusing nested content", () => {
  const state = stateWithSelection(
    [
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [paragraph("One")] },
          { type: "listItem", content: [paragraph("Two")] },
        ],
      },
    ],
    4,
  );

  const transaction = moveBlockAtSelection(state, 1);
  assert.ok(transaction);

  const next = state.apply(transaction);
  const list = next.doc.child(0);
  assert.equal(list.type.name, "bulletList");
  assert.equal(list.child(0).textContent, "Two");
  assert.equal(list.child(1).textContent, "One");
  assert.equal(next.selection.from, 11);
  assert.equal(next.selection.$from.parent.textContent, "One");
});

test("climbs out of a single-child wrapper so the wrapper moves", () => {
  const state = stateWithSelection(
    [
      { type: "blockquote", content: [paragraph("Quoted")] },
      paragraph("After"),
    ],
    3,
  );

  const transaction = moveBlockAtSelection(state, 1);
  assert.ok(transaction);

  const next = state.apply(transaction);
  assert.equal(next.doc.child(0).type.name, "paragraph");
  assert.equal(next.doc.child(0).textContent, "After");
  assert.equal(next.doc.child(1).type.name, "blockquote");
  assert.equal(next.selection.$from.parent.textContent, "Quoted");
});

test("moves a selected atom block and keeps it selected", () => {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [paragraph("Before"), { type: "horizontalRule" }],
  });
  const state = EditorState.create({
    schema,
    doc,
    selection: NodeSelection.create(doc, doc.child(0).nodeSize),
  });

  const transaction = moveBlockAtSelection(state, -1);
  assert.ok(transaction);

  const next = state.apply(transaction);
  assert.equal(next.doc.child(0).type.name, "horizontalRule");
  assert.equal(next.doc.child(1).textContent, "Before");
  assert.ok(next.selection instanceof NodeSelection);
  assert.equal(next.selection.from, 0);
});

test("refuses to move past the first or last block", () => {
  const atStart = stateWithSelection([paragraph("Alpha"), paragraph("Beta")], 3);
  assert.equal(moveBlockAtSelection(atStart, -1), null);

  const doc = atStart.doc;
  const atEnd = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, doc.content.size - 3),
  });
  assert.equal(moveBlockAtSelection(atEnd, 1), null);
});

test("moves every block a multi-block selection covers", () => {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [paragraph("Alpha"), paragraph("Beta"), paragraph("Gamma")],
  });
  // From one character into "Alpha" to one character into "Beta".
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 2, doc.child(0).nodeSize + 2),
  });

  const transaction = moveBlockAtSelection(state, 1);
  assert.ok(transaction);

  const next = state.apply(transaction);
  assert.deepEqual(textsOf(next.doc), ["Gamma", "Alpha", "Beta"]);
  // The pair keeps its internal layout, so both endpoints shift by "Gamma".
  assert.equal(next.selection.anchor, 9);
  assert.equal(next.selection.head, 16);
  assert.equal(next.selection.from, 9);
  assert.equal(next.selection.to, 16);
});

test("moves selected list items together and keeps the selection", () => {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [paragraph("One")] },
          { type: "listItem", content: [paragraph("Two")] },
          { type: "listItem", content: [paragraph("Three")] },
        ],
      },
    ],
  });
  const itemSize = doc.child(0).child(0).nodeSize;
  const listStart = 1;
  const state = EditorState.create({
    schema,
    doc,
    // From one character into "Two" to one character into "Three".
    selection: TextSelection.create(
      doc,
      listStart + itemSize + 3,
      listStart + itemSize * 2 + 3,
    ),
  });

  const transaction = moveBlockAtSelection(state, -1);
  assert.ok(transaction);

  const next = state.apply(transaction);
  const list = next.doc.child(0);
  assert.deepEqual(
    [list.child(0).textContent, list.child(1).textContent, list.child(2).textContent],
    ["Two", "Three", "One"],
  );
  assert.equal(next.selection.anchor, 4);
  assert.equal(next.selection.head, 11);
  assert.equal(next.selection.$from.parent.textContent, "Two");
  assert.equal(next.selection.$to.parent.textContent, "Three");
});

test("refuses a multi-block move past the last covered block", () => {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [paragraph("One")] },
          { type: "listItem", content: [paragraph("Two")] },
        ],
      },
    ],
  });
  const itemSize = doc.child(0).child(0).nodeSize;
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 1 + 3, 1 + itemSize + 3),
  });

  assert.equal(moveBlockAtSelection(state, 1), null);
  assert.equal(moveBlockAtSelection(state, -1), null);
});

test("refuses to move table rows and cells", () => {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableHeader", content: [paragraph("One")] }],
          },
          {
            type: "tableRow",
            content: [{ type: "tableCell", content: [paragraph("Two")] }],
          },
        ],
      },
    ],
  });

  let cursor = 0;
  doc.descendants((node, pos) => {
    if (node.isText && node.text === "One") {
      cursor = pos + 1;
      return false;
    }
    return true;
  });
  assert.ok(cursor > 0, "found the first cell's text");

  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, cursor),
  });

  assert.equal(moveBlockAtSelection(state, 1), null);
});

test("builds a whole-block drag group for a multi-block selection", () => {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [paragraph("Alpha"), paragraph("Beta"), paragraph("Gamma")],
  });
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 2, doc.child(0).nodeSize + 2),
  });

  const group = selectedBlockGroup(state);
  assert.ok(group);
  assert.equal(group.from, 0);
  assert.equal(group.to, doc.child(0).nodeSize + doc.child(1).nodeSize);
  assert.equal(group.slice.content.childCount, 2);
  assert.equal(group.slice.content.textBetween(0, group.slice.content.size, "|"), "Alpha|Beta");

  // Dropping deletes this selection first, so it must remove exactly the group.
  const transaction = state.tr.setSelection(group.selection);
  transaction.deleteSelection();
  assert.deepEqual(textsOf(state.apply(transaction).doc), ["Gamma"]);
});

test("has no drag group when the selection covers one block", () => {
  const state = stateWithSelection([paragraph("Alpha"), paragraph("Beta")], 3);
  assert.equal(selectedBlockGroup(state), null);
});

test("builds a drag ghost holding every block in the group", () => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit],
    content: "<p>One</p><p>Two</p><p>Three</p>",
  });

  try {
    const doc = editor.state.doc;
    const image = buildBlockDragImage(editor, [0, doc.child(0).nodeSize]);
    assert.ok(image);
    assert.equal(image.dataset.kbsDragImage, "true");
    assert.deepEqual(
      Array.from(image.querySelectorAll("p")).map((node) => node.textContent),
      ["One", "Two"],
    );
    image.remove();
  } finally {
    editor.destroy();
    element.remove();
  }
});

test("keeps list structure and block spacing in the drag ghost", () => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit],
    content: "<ul><li><p>One</p></li><li><p>Two</p></li></ul><p>After</p>",
  });

  try {
    const list = editor.state.doc.child(0);
    const image = buildBlockDragImage(editor, [1, 1 + list.child(0).nodeSize]);
    assert.ok(image);
    // The scoped `.tiptap` rules only apply with the editor's class context.
    assert.ok(image.classList.contains("tiptap"), "the ghost keeps scoped editor styles");

    const ghostList = image.querySelector("ul");
    assert.ok(ghostList, "list items are rebuilt inside a list");
    assert.deepEqual(
      Array.from(ghostList.querySelectorAll("li")).map((item) => item.textContent),
      ["One", "Two"],
    );

    const paragraph = image.querySelector("p");
    assert.equal(paragraph?.style.margin, "", "spacing is left to the stylesheet");
    image.remove();
  } finally {
    editor.destroy();
    element.remove();
  }
});
