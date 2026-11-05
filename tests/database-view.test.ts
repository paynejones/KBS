import assert from "node:assert/strict";
import test from "node:test";
import {
  applyView,
  filterNeedsValue,
  filterRecords,
  isFilterableProperty,
  operatorsForProperty,
  parseViewFilters,
  parseViewSorts,
  sortRecords,
  type ViewFilter,
  type ViewProperty,
  type ViewRecord,
} from "../src/lib/database-view";

const TEXT = "11111111-1111-4111-8111-111111111111";
const STATUS = "22222222-2222-4222-8222-222222222222";
const SCORE = "33333333-3333-4333-8333-333333333333";
const DUE = "44444444-4444-4444-8444-444444444444";
const DONE = "55555555-5555-4555-8555-555555555555";
const TAGS = "66666666-6666-4666-8666-666666666666";

const properties: ViewProperty[] = [
  { id: TEXT, name: "Notes", type: "text" },
  { id: STATUS, name: "Status", type: "select" },
  { id: SCORE, name: "Score", type: "number" },
  { id: DUE, name: "Due", type: "date" },
  { id: DONE, name: "Finished", type: "checkbox" },
  { id: TAGS, name: "Tags", type: "multi_select" },
];

const records: ViewRecord[] = [
  {
    id: "a",
    title: "Alpha",
    values: {
      [TEXT]: "Harvest planning",
      [STATUS]: "In progress",
      [SCORE]: 7,
      [DUE]: "2026-11-02",
      [DONE]: false,
      [TAGS]: ["garden", "autumn"],
    },
  },
  {
    id: "b",
    title: "Beta",
    values: {
      [TEXT]: "Budget review",
      [STATUS]: "Done",
      [SCORE]: 12,
      [DUE]: "2026-10-20",
      [DONE]: true,
      [TAGS]: ["money"],
    },
  },
  {
    id: "c",
    title: "Gamma",
    values: { [TEXT]: "", [STATUS]: "", [DUE]: "2026-12-01" },
  },
];

function filter(overrides: Partial<ViewFilter> & Pick<ViewFilter, "propertyId" | "operator">): ViewFilter {
  return { id: overrides.propertyId, value: "", ...overrides };
}

test("saved view filters survive malformed JSON and unknown operators", () => {
  assert.deepEqual(parseViewFilters(undefined), []);
  assert.deepEqual(parseViewFilters({ filters: "nope" }), []);

  const parsed = parseViewFilters({
    filters: [
      { propertyId: SCORE, operator: "greater_than", value: "5" },
      { propertyId: SCORE, operator: "explode", value: "6" },
      { operator: "is", value: "orphan" },
      { propertyId: DUE, operator: "before" },
    ],
  });

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, `${SCORE}:0`, "filters without an id get a stable fallback");
  assert.equal(parsed[0].value, "5");
  assert.equal(parsed[1].id, `${DUE}:1`);
  assert.equal(parsed[1].value, "");
});

test("saved view sorts default to name order and drop duplicates", () => {
  assert.deepEqual(parseViewSorts(undefined), [{ propertyId: "title", direction: "asc" }]);
  assert.deepEqual(parseViewSorts({ sorts: [] }), [{ propertyId: "title", direction: "asc" }]);

  const parsed = parseViewSorts({
    sorts: [
      { propertyId: DUE, direction: "desc" },
      { propertyId: DUE, direction: "asc" },
      { propertyId: SCORE, direction: "sideways" },
    ],
  });

  assert.deepEqual(parsed, [
    { propertyId: DUE, direction: "desc" },
    { propertyId: SCORE, direction: "asc" },
  ]);
});

test("text, select, number, date, checkbox, and multi-select filters match records", () => {
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: TEXT, operator: "contains", value: "harvest" })]).map((record) => record.id),
    ["a"],
  );
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: STATUS, operator: "is", value: "Done" })]).map((record) => record.id),
    ["b"],
  );
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: SCORE, operator: "greater_than", value: "10" })]).map((record) => record.id),
    ["b"],
  );
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: DUE, operator: "after", value: "2026-11-01" })]).map((record) => record.id),
    ["a", "c"],
  );
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: DONE, operator: "is_checked" })]).map((record) => record.id),
    ["b"],
  );
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: TAGS, operator: "contains", value: "garden" })]).map((record) => record.id),
    ["a"],
  );
});

test("empty filters, missing properties, and unset values stay inactive", () => {
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: TEXT, operator: "contains", value: "   " })]).map((record) => record.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: "missing", operator: "is", value: "x" })]).map((record) => record.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: TEXT, operator: "is_empty" })]).map((record) => record.id),
    ["c"],
  );
});

test("filters combine with AND semantics", () => {
  const visible = filterRecords(records, properties, [
    filter({ propertyId: TEXT, operator: "is_not_empty" }),
    filter({ propertyId: SCORE, operator: "less_than", value: "10" }),
  ]);

  assert.deepEqual(visible.map((record) => record.id), ["a"]);
});

test("sorting uses multiple rules in order and supports rollup-style values", () => {
  const sorted = sortRecords(records, properties, [
    { propertyId: STATUS, direction: "asc" },
    { propertyId: SCORE, direction: "desc" },
  ]);
  assert.deepEqual(sorted.map((record) => record.id), ["c", "b", "a"]);

  const byScore = sortRecords(records, properties, [{ propertyId: SCORE, direction: "desc" }]);
  assert.deepEqual(byScore.map((record) => record.id), ["b", "a", "c"]);

  const rollupProperties: ViewProperty[] = [...properties, { id: "rollup", name: "Links", type: "rollup" }];
  const rollupSorted = sortRecords(records, rollupProperties, [{ propertyId: "rollup", direction: "desc" }], {
    valueFor: (record, property) => property.type === "rollup" ? { a: 1, b: 3, c: 2 }[record.id as "a" | "b" | "c"] : record.values[property.id],
  });
  assert.deepEqual(rollupSorted.map((record) => record.id), ["b", "c", "a"]);
});

test("applyView filters before sorting", () => {
  const visible = applyView(records, properties, [
    filter({ propertyId: DONE, operator: "is_not_checked" }),
  ], [{ propertyId: SCORE, direction: "asc" }]);

  assert.deepEqual(visible.map((record) => record.id), ["c", "a"]);
});

test("URL values filter like text and empty values behave consistently", () => {
  const urlProperties: ViewProperty[] = [...properties, { id: "url", name: "Link", type: "url" }];
  const rows: ViewRecord[] = [
    { id: "x", title: "X", values: { url: "https://example.com/harvest" } },
    { id: "y", title: "Y", values: { url: "" } },
    { id: "z", title: "Z", values: {} },
  ];

  assert.deepEqual(
    filterRecords(rows, urlProperties, [filter({ propertyId: "url", operator: "contains", value: "EXAMPLE" })]).map((row) => row.id),
    ["x"],
  );
  assert.deepEqual(
    filterRecords(rows, urlProperties, [filter({ propertyId: "url", operator: "is_empty" })]).map((row) => row.id),
    ["y", "z"],
  );
});

test("negative operators keep rows with missing values", () => {
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: TEXT, operator: "does_not_contain", value: "harvest" })]).map((record) => record.id),
    ["b", "c"],
  );
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: STATUS, operator: "is_not", value: "Done" })]).map((record) => record.id),
    ["a", "c"],
  );
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: TAGS, operator: "does_not_contain", value: "garden" })]).map((record) => record.id),
    ["b", "c"],
  );
});

test("date and number comparisons are strict about equality and invalid input", () => {
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: DUE, operator: "before", value: "2026-11-02" })]).map((record) => record.id),
    ["b"],
  );
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: DUE, operator: "is", value: "2026-11-02" })]).map((record) => record.id),
    ["a"],
  );
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: SCORE, operator: "greater_than", value: "not a number" })]).map((record) => record.id),
    ["a", "b", "c"],
    "an unparseable comparison value should leave the filter inactive",
  );
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: SCORE, operator: "less_than", value: "8" })]).map((record) => record.id),
    ["a"],
  );
});

test("checkbox filters separate checked, unchecked, and missing values", () => {
  assert.deepEqual(
    filterRecords(records, properties, [filter({ propertyId: DONE, operator: "is_not_checked" })]).map((record) => record.id),
    ["a", "c"],
  );
});

test("operator helpers match property types and value requirements", () => {
  assert.deepEqual(operatorsForProperty("checkbox"), ["is_checked", "is_not_checked"]);
  assert.ok(operatorsForProperty("date").includes("before"));
  assert.ok(operatorsForProperty("number").includes("greater_than"));
  assert.equal(filterNeedsValue("is_empty"), false);
  assert.equal(filterNeedsValue("is_not_checked"), false);
  assert.equal(filterNeedsValue("contains"), true);
  assert.equal(isFilterableProperty("relation"), false);
  assert.equal(isFilterableProperty("rollup"), false);
  assert.equal(isFilterableProperty("file"), false);
  assert.equal(isFilterableProperty("text"), true);
});

test("filters and sorts are capped and tolerate non-object entries", () => {
  const manyFilters = parseViewFilters({
    filters: [
      null,
      "nope",
      ...Array.from({ length: 20 }, (_, index) => ({
        propertyId: `property-${index}`,
        operator: "is",
        value: String(index),
      })),
    ],
  });
  assert.equal(manyFilters.length, 12);

  const manySorts = parseViewSorts({
    sorts: Array.from({ length: 6 }, (_, index) => ({ propertyId: `property-${index}`, direction: "asc" })),
  });
  assert.equal(manySorts.length, 3);
});

test("sorting is stable and leaves the source array untouched", () => {
  const input = [...records];
  const sorted = sortRecords(input, properties, [{ propertyId: STATUS, direction: "asc" }]);

  assert.deepEqual(input.map((record) => record.id), ["a", "b", "c"], "sorting must not mutate the records passed in");
  assert.deepEqual(sortRecords(records, properties, []).map((record) => record.id), ["a", "b", "c"],
    "no sort rules keeps the incoming order");
  assert.notEqual(sorted, input);
});
