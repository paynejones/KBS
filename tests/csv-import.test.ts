import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCsvRecords,
  parseCsv,
  planCsvColumns,
  type CsvImportProperty,
} from "../src/lib/csv-import";

function parse(text: string) {
  const result = parseCsv(text);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result;
}

test("CSV parsing handles BOMs, quoted commas, escaped quotes, and CRLF", () => {
  const result = parse('\uFEFFName,Notes\r\n"Reading, slowly","She said ""hi"""\r\nPlain,\r\n');
  assert.deepEqual(result.headers, ["Name", "Notes"]);
  assert.deepEqual(result.rows, [["Reading, slowly", 'She said "hi"'], ["Plain", ""]]);
});

test("CSV parsing keeps newlines inside quoted fields and skips blank lines", () => {
  const result = parse('Name,Notes\n"Two\nlines",ok\n\n\n');
  assert.deepEqual(result.rows, [["Two\nlines", "ok"]]);
});

test("CSV parsing reports unclosed quotes and missing headers", () => {
  assert.deepEqual(parseCsv('Name,Notes\n"open,closed'), { ok: false, error: "The CSV file has an unclosed quote." });
  assert.deepEqual(parseCsv(""), { ok: false, error: "The CSV file is empty." });
  assert.deepEqual(parseCsv(",,\n,,"), { ok: false, error: "The CSV needs a header row." });
});

const properties: CsvImportProperty[] = [
  { id: "score", name: "Score", type: "number", options: {} },
  { id: "done", name: "Done", type: "checkbox", options: {} },
  { id: "status", name: "Status", type: "select", options: { choices: ["Todo", "Done"] } },
  { id: "tags", name: "Tags", type: "multi_select", options: { choices: ["a", "b", "c"] } },
  { id: "total", name: "Total", type: "rollup", options: { relationPropertyId: "rel", aggregation: "sum" } },
];

test("columns map by name, ignore computed columns, and create text properties", () => {
  const plan = planCsvColumns(
    ["Name", "Score", "Status", "Tags", "Total", "Linked page", "Author"],
    properties,
  );
  assert.equal(plan.titleIndex, 0);
  assert.deepEqual(plan.columns.map((column) => column.key), ["score", "status", "tags", "new:author"]);
  assert.deepEqual(plan.newPropertyNames, ["Author"]);
  assert.deepEqual(plan.ignoredColumns, ["Total", "Linked page"]);
});

test("the first column becomes the title when there is no Name column", () => {
  const plan = planCsvColumns(["Title text", "Score"], properties);
  assert.equal(plan.titleIndex, 0);
  assert.deepEqual(plan.columns.map((column) => column.key), ["score"]);
});

test("values convert by property type and unusable cells stay blank", () => {
  const { headers, rows } = parse([
    "Name,Score,Done,Status,Tags,Author",
    'One,12.5,yes,Done,"a | c",Ada',
    'Two,not a number,maybe,Nope,z,',
  ].join("\n"));
  const plan = planCsvColumns(headers, properties);
  const ids = new Map([
    ["score", "score"],
    ["done", "done"],
    ["status", "status"],
    ["tags", "tags"],
    ["new:author", "author"],
  ]);
  const result = buildCsvRecords(rows, plan, ids);

  assert.equal(result.skippedCells, 4);
  assert.equal(result.skippedRows, 0);
  assert.deepEqual(result.records, [
    { title: "One", values: { score: 12.5, done: true, status: "Done", tags: ["a", "c"], author: "Ada" } },
    { title: "Two", values: {} },
  ]);
});

test("a record without a title is imported and unusable rows are skipped", () => {
  const { headers, rows } = parse("Name,Score\nAda,7\n,9\n,\n");
  const plan = planCsvColumns(headers, properties);
  const withIds = buildCsvRecords(rows, plan, new Map([["score", "score"]]));
  assert.deepEqual(withIds.records, [
    { title: "Ada", values: { score: 7 } },
    { title: "Untitled", values: { score: 9 } },
  ]);
  assert.equal(withIds.skippedRows, 0);

  // Without a property id the Score column is unusable, so a nameless row has nothing to import.
  const withoutIds = buildCsvRecords([["", "9"]], plan, new Map());
  assert.deepEqual(withoutIds.records, []);
  assert.equal(withoutIds.skippedRows, 1);
});
