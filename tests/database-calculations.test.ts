import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formulaReferenceCycle,
  formulaValue,
  rollupValue,
  type CalculationProperty,
  type RelationTargetMap,
} from "../src/lib/database-calculations";
import { buttonExpressionError, evaluateButtonExpression } from "../src/lib/database-button";

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

test("buttons and formulas read the same references", () => {
  const properties = [score, total];
  const evaluated = evaluateButtonExpression("{Total} + 1", properties, record, targets);
  assert.equal(evaluated.ok, true);
  assert.equal(evaluated.ok ? evaluated.value : null, 13.5);

  const calculated: CalculationProperty = {
    id: "calculated",
    name: "Calculated",
    type: "formula",
    options: { expression: "{Total} + 1" },
  };
  assert.equal(
    evaluated.ok ? evaluated.value : null,
    formulaValue(record, calculated, properties, targets),
    "a button expression and a formula agree on a rollup reference",
  );

  assert.equal(buttonExpressionError("{Score} + 1", properties), null);
  assert.equal(buttonExpressionError("{Total} + 1", properties), null);
  assert.match(buttonExpressionError("{Missing} + 1", properties) ?? "", /Unknown property/);

  const note: CalculationProperty = { id: "note", name: "Note", type: "text", options: {} };
  assert.match(
    buttonExpressionError("{Note} + 1", [...properties, note]) ?? "",
    /number, rollup, or formula/,
  );
});

test("button expressions read formula properties, including nested ones", () => {
  const doubled: CalculationProperty = {
    id: "doubled",
    name: "Doubled",
    type: "formula",
    options: { expression: "{Score} * 2" },
  };
  const plusTotal: CalculationProperty = {
    id: "plus-total",
    name: "Plus total",
    type: "formula",
    options: { expression: "{Doubled} + {Total}" },
  };
  const properties = [score, total, doubled, plusTotal];

  assert.equal(buttonExpressionError("{Plus total} + 1", properties), null);
  const evaluated = evaluateButtonExpression("{Plus total} + 1", properties, record, targets);
  assert.equal(evaluated.ok, true);
  // {Doubled} = 8, {Total} = 12.5, then + 1.
  assert.equal(evaluated.ok ? evaluated.value : null, 21.5);
});

test("formula reference cycles are reported before they are saved", () => {
  const first: CalculationProperty = {
    id: "first",
    name: "First",
    type: "formula",
    options: { expression: "{Second} + 1" },
  };
  const second: CalculationProperty = {
    id: "second",
    name: "Second",
    type: "formula",
    options: { expression: "{Score} + 1" },
  };
  const properties = [score, total, first, second];

  assert.equal(formulaReferenceCycle(["First"], properties), null);
  assert.equal(formulaReferenceCycle(["Score"], properties), null);
  assert.equal(formulaReferenceCycle(["Total"], properties), null);

  const looped: CalculationProperty[] = [
    { id: "a", name: "A", type: "formula", options: { expression: "{B} + 1" } },
    { id: "b", name: "B", type: "formula", options: { expression: "{C} + 1" } },
    { id: "c", name: "C", type: "formula", options: { expression: "{A} + 1" } },
  ];
  assert.equal(formulaReferenceCycle(["A"], looped), "A → B → C → A");
});

test("a formula cycle yields no value instead of recursing", () => {
  const first: CalculationProperty = {
    id: "first",
    name: "First",
    type: "formula",
    options: { expression: "{Second} + 1" },
  };
  const second: CalculationProperty = {
    id: "second",
    name: "Second",
    type: "formula",
    options: { expression: "{First} + 1" },
  };
  const evaluated = evaluateButtonExpression("{First}", [first, second], record, targets);
  assert.equal(evaluated.ok, true);
  assert.equal(evaluated.ok ? evaluated.value : null, null);
});
