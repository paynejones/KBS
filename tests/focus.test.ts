import assert from "node:assert/strict";
import test from "node:test";
import {
  FOCUS_RECENT_LIMIT,
  focusShortcuts,
  focusTaskProgress,
  focusTasks,
  parseFocusRecentIds,
  rememberFocusProject,
  taskCompletionChanges,
  toggleTaskInDocument,
} from "../src/lib/focus";

const document = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Milestones" }] },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Draft plan" }] }],
        },
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Share plan" }] }],
        },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: {},
          content: [{ type: "paragraph", content: [{ type: "text", text: "Book the room" }] }],
        },
      ],
    },
  ],
};

test("extracts task items with their document path", () => {
  const tasks = focusTasks(document, "page-1", "Launch");

  assert.deepEqual(
    tasks.map(({ text, checked, path }) => ({ text, checked, path })),
    [
      { text: "Draft plan", checked: false, path: [1, 0] },
      { text: "Share plan", checked: true, path: [1, 1] },
      { text: "Book the room", checked: false, path: [2, 0] },
    ],
  );
  assert.equal(tasks[0].pageId, "page-1");
  assert.equal(tasks[0].pageTitle, "Launch");
});

test("ignores empty task items and malformed documents", () => {
  assert.deepEqual(focusTasks(null, "p", "t"), []);
  assert.deepEqual(focusTasks({ type: "doc" }, "p", "t"), []);
  assert.deepEqual(
    focusTasks({ type: "doc", content: [{ type: "taskItem", content: [] }] }, "p", "t"),
    [],
  );
  assert.equal(focusTasks(document, "p", "t", 1).length, 1, "the limit caps one page");
  assert.equal(focusTasks(document, "p", "t", 0).length, 0);
});

test("toggling a task keeps the rest of the document intact", () => {
  const next = toggleTaskInDocument(document, [1, 1], false);

  assert.ok(next);
  assert.deepEqual(
    focusTasks(next, "p", "t").map((task) => task.checked),
    [false, false, false],
  );
  // The source is untouched, so a failed save cannot leave a half-applied edit.
  assert.equal(focusTasks(document, "p", "t")[1].checked, true);
  assert.equal(
    focusTasks(next, "p", "t")[0].text,
    "Draft plan",
    "neighbouring tasks stay readable",
  );
});

test("a stale or invalid path is refused instead of writing nearby", () => {
  assert.equal(toggleTaskInDocument(document, [], true), null);
  assert.equal(toggleTaskInDocument(document, [1, 9], true), null);
  assert.equal(toggleTaskInDocument(document, [0], true), null);
  assert.equal(toggleTaskInDocument(document, [0, 0], true), null);
  assert.equal(toggleTaskInDocument(null, [1, 0], true), null);
});

test("editor check-offs are found by diffing saved documents", () => {
  assert.deepEqual(taskCompletionChanges(document, toggleTaskInDocument(document, [1, 0], true)), [
    { text: "Draft plan", checked: true },
  ]);
  assert.deepEqual(taskCompletionChanges(document, toggleTaskInDocument(document, [1, 1], false)), [
    { text: "Share plan", checked: false },
  ]);
  assert.deepEqual(taskCompletionChanges(document, document), []);
  assert.deepEqual(taskCompletionChanges({}, document), [
    { text: "Share plan", checked: true },
  ]);
});

test("moving a task list does not look like checking tasks off", () => {
  const moved = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "A new opening line" }] },
      ...(document.content as unknown[]),
    ],
  };

  assert.deepEqual(taskCompletionChanges(document, moved), []);
});

test("deleting a finished task keeps its history", () => {
  const withoutFinished = {
    type: "doc",
    content: [document.content[0], {
      type: "taskList",
      content: [document.content[1].content![0]],
    }],
  };

  assert.deepEqual(taskCompletionChanges(document, withoutFinished), []);
});

test("recent project storage is parsed defensively", () => {
  assert.deepEqual(parseFocusRecentIds(null), []);
  assert.deepEqual(parseFocusRecentIds("not json"), []);
  assert.deepEqual(parseFocusRecentIds('{"a":1}'), []);
  assert.deepEqual(
    parseFocusRecentIds('["a","b","a","",42,"  ","c"]'),
    ["a", "b", "c"],
  );
});

test("remembering a project moves it to the front and caps the list", () => {
  assert.deepEqual(rememberFocusProject(["b", "a"], "a"), ["a", "b"]);
  assert.deepEqual(rememberFocusProject(["b"], "c"), ["c", "b"]);
  assert.deepEqual(rememberFocusProject([], ""), []);
  assert.equal(
    rememberFocusProject(["a", "b", "c", "d", "e", "f"], "g").length,
    FOCUS_RECENT_LIMIT,
  );
});

test("quick switch keeps favorites first and drops duplicates", () => {
  assert.deepEqual(
    focusShortcuts(["fav-a", "fav-b"], ["recent-a", "fav-a"]),
    ["fav-a", "fav-b", "recent-a"],
  );
  assert.deepEqual(focusShortcuts([], []), []);
  assert.equal(focusShortcuts(["a"], ["b", "c", "d", "e", "f", "g", "h"], 3).length, 3);
});

test("progress counts done tasks and rounds the percentage", () => {
  assert.deepEqual(
    focusTaskProgress([{ checked: true }, { checked: false }, { checked: false }]),
    { total: 3, done: 1, open: 2, percent: 33 },
  );
  assert.deepEqual(focusTaskProgress([]), { total: 0, done: 0, open: 0, percent: 0 });
});
