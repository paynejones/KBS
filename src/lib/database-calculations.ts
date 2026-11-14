import { evaluateFormula, parseFormula, type FormulaNode } from "@/lib/database-formula";
import type { DatabasePropertyType } from "./database-property";

export type CalculationProperty = {
  id: string;
  name: string;
  type: DatabasePropertyType;
  options: Record<string, unknown>;
};

export type CalculationRecord = {
  values: Record<string, unknown>;
  relations?: Record<string, string[]>;
};

export type RelationTargetRecord = { id: string; values: Record<string, unknown> };
export type RelationTargetData = { properties: CalculationProperty[]; records: RelationTargetRecord[] };
export type RelationTargetMap = Record<string, RelationTargetData>;

function optionString(property: CalculationProperty, key: string) {
  const value = property.options[key];
  return typeof value === "string" ? value : "";
}

function numericValues(record: CalculationRecord, property: CalculationProperty, targets: RelationTargetMap) {
  const relationPropertyId = optionString(property, "relationPropertyId");
  const targetIds = relationPropertyId ? record.relations?.[relationPropertyId] ?? [] : [];
  const targetPropertyId = optionString(property, "targetPropertyId");
  return targetIds
    .map((targetId) => targets[relationPropertyId]?.records.find((item) => item.id === targetId)?.values[targetPropertyId])
    // A cleared number is stored as null or an empty string, and Number() turns
    // both into 0. They are blank, not zero, so they must not pull an average,
    // minimum, or maximum towards zero.
    .map((value) => {
      if (typeof value === "number") return value;
      if (typeof value === "string" && value.trim() !== "") return Number(value);
      return Number.NaN;
    })
    .filter(Number.isFinite);
}

/** A rollup aggregates one numeric property across the records a relation links to. */
export function rollupValue(
  record: CalculationRecord,
  property: CalculationProperty,
  targets: RelationTargetMap,
): number | string {
  const relationPropertyId = optionString(property, "relationPropertyId");
  const targetIds = relationPropertyId ? record.relations?.[relationPropertyId] ?? [] : [];
  if (property.options.aggregation === "count") return targetIds.length;
  const values = numericValues(record, property, targets);
  if (values.length === 0) return "—";
  switch (property.options.aggregation) {
    case "sum": return values.reduce((sum, value) => sum + value, 0);
    case "average": return values.reduce((sum, value) => sum + value, 0) / values.length;
    case "min": return Math.min(...values);
    case "max": return Math.max(...values);
    default: return "—";
  }
}

/**
 * One `{Property}` reference, resolved the way a formula resolves it: a number
 * property's current value, a rollup over the record's linked records, or
 * another formula on the same record. `seen` stops a formula that references
 * itself, directly or through a cycle, from recursing forever.
 */
export function referenceValue(
  name: string,
  record: CalculationRecord,
  properties: CalculationProperty[],
  targets: RelationTargetMap,
  seen: ReadonlySet<string> = new Set(),
): number | null {
  const referenced = properties.find((candidate) => candidate.name === name);
  if (!referenced) return null;
  if (referenced.type === "number") {
    const value = record.values[referenced.id];
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const text = String(value ?? "").trim();
    const numeric = Number(text);
    return text !== "" && Number.isFinite(numeric) ? numeric : null;
  }
  if (referenced.type === "rollup") {
    const value = rollupValue(record, referenced, targets);
    return typeof value === "number" ? value : null;
  }
  if (referenced.type === "formula") {
    if (seen.has(referenced.id)) return null;
    const parsed = parseFormula(optionString(referenced, "expression"));
    if (!parsed.ok) return null;
    const ancestors = new Set(seen).add(referenced.id);
    return evaluateFormula(parsed.ast, (nested) =>
      referenceValue(nested, record, properties, targets, ancestors),
    );
  }
  return null;
}

/**
 * Evaluates a parsed expression against one record. Formulas and button actions
 * both evaluate through this, so `{Total} + 1` means the same number in either
 * place and a new reference type only has to be taught to `referenceValue`.
 */
export function evaluateRecordFormula(
  ast: FormulaNode,
  record: CalculationRecord,
  properties: CalculationProperty[],
  targets: RelationTargetMap,
): number | null {
  return evaluateFormula(ast, (name) => referenceValue(name, record, properties, targets));
}

/**
 * Follows formula references through the formulas they name and returns the
 * first cycle as `A → B → A`, or null when every reference terminates.
 * `referenceValue` would make a cycle blank forever, so property validation
 * rejects one before it is saved.
 */
export function formulaReferenceCycle(
  references: string[],
  properties: CalculationProperty[],
): string | null {
  const byName = new Map(properties.map((property) => [property.name, property]));
  const visited = new Set<string>();

  const walk = (names: string[], path: string[]): string | null => {
    for (const name of names) {
      if (path.includes(name)) return [...path, name].join(" → ");
      if (visited.has(name)) continue;
      visited.add(name);
      const property = byName.get(name);
      if (!property || property.type !== "formula") continue;
      const parsed = parseFormula(optionString(property, "expression"));
      if (!parsed.ok) continue;
      const cycle = walk(parsed.references, [...path, name]);
      if (cycle) return cycle;
    }
    return null;
  };

  return walk(references, []);
}

/** A formula reads number properties and rollups from the same record. */
export function formulaValue(
  record: CalculationRecord,
  property: CalculationProperty,
  properties: CalculationProperty[],
  targets: RelationTargetMap,
): number | null {
  const parsed = parseFormula(optionString(property, "expression"));
  if (!parsed.ok) return null;
  return evaluateRecordFormula(parsed.ast, record, properties, targets);
}
