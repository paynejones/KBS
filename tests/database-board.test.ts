import assert from "node:assert/strict";
import test from "node:test";
import { boardColumnsFor, boardSectionsFor } from "../src/lib/database-board";

const statusProperty = {
  id: "status",
  name: "Status",
  type: "select",
  options: { choices: ["Todo", "Done"] },
};

test("a select board keeps every choice plus a no-value column", () => {
  const records = [
    { id: "a", values: { status: "Todo" } },
    { id: "b", values: { status: "Done" } },
    { id: "c", values: {} },
  ];

  const columns = boardColumnsFor({ property: statusProperty, records });

  assert.deepEqual(columns.map((column) => column.label), ["No value", "Todo", "Done"]);
  assert.deepEqual(columns.map((column) => column.records.map((record) => record.id)), [["c"], ["a"], ["b"]]);
});

test("a relation board uses linked records as columns and shows unlinked rows", () => {
  const property = { id: "project", name: "Project", type: "relation" };
  const records = [
    { id: "a", values: {}, relations: { project: ["p1"] } },
    { id: "b", values: {}, relations: { project: ["p2", "p1"] } },
    { id: "c", values: {} },
  ];

  const columns = boardColumnsFor({
    property,
    records,
    relationTargets: [
      { id: "p1", title: "Alpha" },
      { id: "p2", title: "" },
    ],
  });

  assert.deepEqual(columns.map((column) => column.label), ["Alpha", "Untitled", "No Project"]);
  assert.deepEqual(columns.map((column) => column.key), ["p1", "p2", "__unlinked"]);
  assert.deepEqual(
    columns.map((column) => column.records.map((record) => record.id)),
    [["a", "b"], ["b"], ["c"]],
    "a record linked to two targets is in both columns and none of the unlinked ones",
  );
});

test("a relation board without targets still shows the unlinked column", () => {
  const columns = boardColumnsFor({
    property: { id: "project", name: "Project", type: "relation" },
    records: [{ id: "a", values: {} }],
  });

  assert.deepEqual(columns.map((column) => column.key), ["__unlinked"]);
  assert.deepEqual(columns[0].records.map((record) => record.id), ["a"]);
});

test("a second group property stacks sections inside each column", () => {
  const records = [
    { id: "a", values: { status: "Todo", owner: "Ada" } },
    { id: "b", values: { status: "Todo", owner: "Bo" } },
    { id: "c", values: { status: "Done", owner: "Ada" } },
  ];
  const owner = { id: "owner", name: "Owner", type: "select", options: { choices: ["Ada", "Bo"] } };

  const sections = boardSectionsFor({ property: statusProperty, records, secondary: { property: owner } });

  assert.deepEqual(sections.map((column) => column.label), ["No value", "Todo", "Done"]);
  assert.deepEqual(
    sections[1].groups?.map((group) => group.label),
    ["No value", "Ada", "Bo"],
  );
  assert.deepEqual(
    sections[1].groups?.map((group) => group.records.map((record) => record.id)),
    [[], ["a"], ["b"]],
    "each stacked section holds only that column's records",
  );
  assert.deepEqual(
    sections[2].groups?.map((group) => group.records.map((record) => record.id)),
    [[], ["c"], []],
  );
});

test("a second relation group stacks its linked records inside each column", () => {
  const records = [
    { id: "a", values: { status: "Todo" }, relations: { project: ["p1"] } },
    { id: "b", values: { status: "Todo" } },
  ];

  const sections = boardSectionsFor({
    property: statusProperty,
    records,
    secondary: {
      property: { id: "project", name: "Project", type: "relation" },
      relationTargets: [{ id: "p1", title: "Alpha" }],
    },
  });

  assert.deepEqual(sections[1].groups?.map((group) => group.label), ["Alpha", "No Project"]);
  assert.deepEqual(
    sections[1].groups?.map((group) => group.records.map((record) => record.id)),
    [["a"], ["b"]],
  );
});

test("without a second property the board keeps flat columns", () => {
  const sections = boardSectionsFor({ property: statusProperty, records: [{ id: "a", values: { status: "Todo" } }] });

  assert.equal(sections.every((column) => column.groups === undefined), true);
});

test("a select board with malformed choices falls back to the no-value column", () => {
  const columns = boardColumnsFor({
    property: { id: "status", name: "Status", type: "select", options: { choices: "nope" } },
    records: [{ id: "a", values: { status: "Todo" } }],
  });

  assert.deepEqual(columns.map((column) => column.key), ["__empty"]);
  assert.deepEqual(columns[0].records, []);
});
