import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { cleanup, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DragHandle } from "@tiptap/extension-drag-handle-react";

let editor: Editor;
let editorRoot: HTMLDivElement;

beforeEach(() => {
  // The drag handle appends its element next to the editor root, so the editor
  // has to live in the document for the handle to be reachable.
  editorRoot = document.createElement("div");
  document.body.appendChild(editorRoot);
  editor = new Editor({
    element: editorRoot,
    extensions: [StarterKit],
    content: "<p>First block</p><p>Second block</p>",
  });
});

afterEach(() => {
  cleanup();
  editor.destroy();
  editorRoot.remove();
});

test("the drag grip registers with the editor and mounts its handle", () => {
  render(
    <DragHandle editor={editor}>
      <div title="Drag to reorder block" />
    </DragHandle>,
  );

  const grip = document.querySelector('[title="Drag to reorder block"]');
  assert.ok(grip, "the grip renders into the drag handle element");

  const handle = grip?.parentElement;
  assert.equal(handle?.dataset.dragging, "false", "the handle starts in its idle state");
  assert.equal(handle?.style.position, "absolute", "the plugin owns the handle positioning");
});

test("the handle unmounts without leaving the plugin registered", () => {
  const { unmount } = render(
    <DragHandle editor={editor}>
      <div title="Drag to reorder block" />
    </DragHandle>,
  );
  unmount();

  assert.equal(document.querySelector('[title="Drag to reorder block"]'), null);
  assert.equal(editor.isDestroyed, false, "unmounting the handle does not destroy the editor");
  assert.ok(editor.view, "the editor keeps its view after the handle unmounts");
});
