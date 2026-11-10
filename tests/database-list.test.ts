import assert from "node:assert/strict";
import test from "node:test";
import { formatListValue, listRows } from "../src/lib/database-list";
import type { ViewProperty } from "../src/lib/database-view";

const properties: ViewProperty[] = [
  { id: "status", name: "Status", type: "select" },
  { id: "score", name: "Score", type: "number" },
  { id: "done", name: "Done", type: "checkbox" },
];

test("list rows keep filled values readable and drop the rest", () => {
  const rows = listRows(
    [
      {
        id: "a",
        title: "Alpha",
        pageId: "page-a",
        values: { status: ["Draft", "Review"], score: 0, done: true },
      },
      { id: "b", title: "  ", values: { status: "", score: null } },
    ],
    properties,
  );

  assert.deepEqual(rows, [
    {
      id: "a",
      title: "Alpha",
      pageId: "page-a",
      values: [
        { id: "status", name: "Status", display: "Draft, Review" },
        { id: "score", name: "Score", display: "0" },
        { id: "done", name: "Done", display: "Yes" },
      ],
    },
    { id: "b", title: "Untitled", pageId: null, values: [] },
  ]);
});

test("list rows can keep blank values, cap properties, and read calculated values", () => {
  const record = {
    id: "a",
    title: "Alpha",
    values: { status: "Draft", score: 3 } as Record<string, unknown>,
  };
  const rows = listRows([record], properties, {
    hideEmpty: false,
    limit: 2,
    valueFor: (row, property) =>
      property.id === "score"
        ? (row.values.score as number) * 10
        : row.values[property.id],
  });

  assert.deepEqual(rows[0].values, [
    { id: "status", name: "Status", display: "Draft" },
    { id: "score", name: "Score", display: "30" },
  ]);
});

test("formatListValue joins arrays and labels booleans", () => {
  assert.equal(formatListValue(["a", "b"]), "a, b");
  assert.equal(formatListValue(false), "No");
  assert.equal(formatListValue(undefined), "");
});
