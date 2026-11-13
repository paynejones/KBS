import { evaluateFormula, parseFormula } from "@/lib/database-formula";
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

/** A formula reads number properties and rollups from the same record. */
export function formulaValue(
  record: CalculationRecord,
  property: CalculationProperty,
  properties: CalculationProperty[],
  targets: RelationTargetMap,
): number | null {
  const parsed = parseFormula(optionString(property, "expression"));
  if (!parsed.ok) return null;
  const propertiesByName = new Map(properties.map((candidate) => [candidate.name, candidate]));
  return evaluateFormula(parsed.ast, (name) => {
    const referenced = propertiesByName.get(name);
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
    return null;
  });
}
