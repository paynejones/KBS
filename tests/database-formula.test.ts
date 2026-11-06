import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateFormula,
  formatFormulaValue,
  parseFormula,
} from "../src/lib/database-formula";

const values: Record<string, number | null> = {
  Watched: 12,
  Total: 24,
  Score: 7.5,
  Missing: null,
};

function resolve(name: string) {
  return values[name] ?? null;
}

function value(expression: string) {
  const parsed = parseFormula(expression);
  assert.ok(parsed.ok, `expected “${expression}” to parse`);
  return evaluateFormula(parsed.ast, resolve);
}

test("formulas follow arithmetic precedence and parentheses", () => {
  assert.equal(value("2 + 3 * 4"), 14);
  assert.equal(value("(2 + 3) * 4"), 20);
  assert.equal(value("-2 + 10"), 8);
  assert.equal(value("100 / 4 / 5"), 5);
  assert.equal(value("1.5 * 2"), 3);
});

test("formulas reference properties by name", () => {
  assert.equal(value("{Watched} / {Total} * 100"), 50);
  assert.equal(value("{ Score } + 1"), 8.5);
});

test("parser reports each referenced property once, in order", () => {
  const parsed = parseFormula("{Watched} + {Total} + {Watched} * {Score}");
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.references, ["Watched", "Total", "Score"]);
});

test("round() rounds to whole numbers or a digit count", () => {
  assert.equal(value("round({Watched} / 5)"), 2);
  assert.equal(value("round(2.345, 2)"), 2.35);
  assert.equal(value("round(2.6, 0)"), 3);
});

test("blank, missing, and divided-by-zero values make the formula blank", () => {
  assert.equal(value("{Missing} + 1"), null);
  assert.equal(value("{Unknown} * 2"), null);
  assert.equal(value("{Watched} / 0"), null);
  assert.equal(value("round({Missing})"), null);
});

test("invalid formulas are rejected with a reason", () => {
  const cases: [string, RegExp][] = [
    ["", /Enter a formula/],
    ["   ", /Enter a formula/],
    ["{Watched} /", /ends before a value/],
    ["2 + * 3", /missing a number or \{property\}/],
    ["(2 + 3", /Unclosed parenthesis/],
    ["{Watched} + 1)", /Unexpected input after the formula/],
    ["{Watched", /Unclosed \{property\} reference/],
    ["{}", /cannot be empty/],
    ["median({Watched})", /Unknown function/],
    ["round()", /takes a value/],
    ["round(1, 2, 3)", /takes a value/],
    ["2 $ 3", /Unexpected character/],
    ["2 + 3 overflow", /Unexpected input after the formula/],
  ];

  for (const [expression, expected] of cases) {
    const parsed = parseFormula(expression);
    assert.equal(parsed.ok, false, `expected “${expression}” to be rejected`);
    if (!parsed.ok) assert.match(parsed.error, expected);
  }
});

test("long formulas are refused", () => {
  const parsed = parseFormula("1 + ".repeat(130) + "1");
  assert.equal(parsed.ok, false);
});

test("formula values render as compact numbers", () => {
  assert.equal(formatFormulaValue(50), "50");
  assert.equal(formatFormulaValue(33.333333333), "33.333333");
  assert.equal(formatFormulaValue(null), "—");
});
