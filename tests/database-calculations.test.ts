import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formulaValue,
  rollupValue,
  type CalculationProperty,
  type RelationTargetMap,
} from "../src/lib/database-calculations";

const score: CalculationProperty = { id: "score", name: "Score", type: "number", options: {} };
const linked: CalculationProperty = {
  id: "linked",
  name: "Linked",
  type: "rollup",
  options: { relationPropertyId: "rel", aggregation: "count" },
};
const total: CalculationProperty = {
  id: "total",
  name: "Total",
  type: "rollup",
  options: { relationPropertyId: "rel", targetPropertyId: "score", aggregation: "sum" },
};
const targets: RelationTargetMap = {
  rel: {
    properties: [score],
    records: [
      { id: "a", values: { score: 10 } },
      { id: "b", values: { score: 2.5 } },
      { id: "c", values: {} },
    ],
  },
};
const record = { values: { score: 4 }, relations: { rel: ["a", "b", "c"] } };

function aggregate(aggregation: string): CalculationProperty {
  return { ...total, options: { ...total.options, aggregation } };
}

test("rollups count linked records", () => {
  assert.equal(rollupValue(record, linked, targets), 3);
  assert.equal(rollupValue({ values: {}, relations: {} }, linked, targets), 0);
});

test("rollups aggregate numeric values from linked records", () => {
  assert.equal(rollupValue(record, total, targets), 12.5);
  assert.equal(rollupValue(record, aggregate("average"), targets), 6.25);
  assert.equal(rollupValue(record, aggregate("min"), targets), 2.5);
  assert.equal(rollupValue(record, aggregate("max"), targets), 10);
});

test("rollups with no values show a dash", () => {
  assert.equal(rollupValue({ values: {}, relations: {} }, total, targets), "—");
  assert.equal(rollupValue({ values: {}, relations: { rel: ["missing"] } }, total, targets), "—");
});

test("rollups ignore cleared numeric values instead of counting them as zero", () => {
  const clearedTargets: RelationTargetMap = {
    rel: {
      properties: [score],
      records: [
        { id: "a", values: { score: 10 } },
        { id: "b", values: { score: null } },
        { id: "c", values: { score: "" } },
      ],
    },
  };
  const clearedRecord = { values: {}, relations: { rel: ["a", "b", "c"] } };

  assert.equal(rollupValue(clearedRecord, total, clearedTargets), 10);
  assert.equal(rollupValue(clearedRecord, aggregate("average"), clearedTargets), 10);
  assert.equal(rollupValue(clearedRecord, aggregate("min"), clearedTargets), 10);
});

test("formulas read number properties and rollups", () => {
  const formula = (expression: string): CalculationProperty => ({
    id: `formula:${expression}`,
    name: "Calculated",
    type: "formula",
    options: { expression },
  });
  const properties = [score, total];
  assert.equal(formulaValue(record, formula("{Score} * 2"), properties, targets), 8);
  assert.equal(formulaValue(record, formula("{Total} + 1"), properties, targets), 13.5);
  assert.equal(formulaValue(record, formula("{Missing} + 1"), properties, targets), null);
  assert.equal(formulaValue(record, formula("{Score} / 0"), properties, targets), null);
});
