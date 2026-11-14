import { z } from "zod";
import {
  type CalculationProperty,
  type CalculationRecord,
  evaluateRecordFormula,
  type RelationTargetMap,
} from "@/lib/database-calculations";
import { MAX_FORMULA_LENGTH, parseFormula } from "@/lib/database-formula";

/**
 * Button actions are deliberately small: a button may write a value to a
 * property on its own record, to records already linked through one of the
 * database's relation properties, to one existing record chosen by the user, or
 * create one new record in a chosen database with initial values.
 *
 * A value is either a literal or an expression such as `{Count} + 1`. The
 * expression is evaluated on the server against the record the button runs on,
 * so a click can raise a number by one without storing the current value.
 * Expressions use the database formula language and the formula resolver, so a
 * button reads exactly what a formula reads — the clicked record's number
 * properties, rollups, and formula properties — and cannot run arbitrary code.
 */
export const BUTTON_WRITABLE_PROPERTY_TYPES = [
  "text",
  "number",
  "checkbox",
  "date",
  "url",
  "select",
  "multi_select",
] as const;

/** Property types that can store the number an expression computes. */
export const BUTTON_EXPRESSION_PROPERTY_TYPES = [
  "number",
  "text",
  "url",
  "date",
  "select",
] as const;

export type ButtonActionLiteral = string | number | boolean | string[] | null;
export type ButtonActionExpression = { expression: string };
export type ButtonActionValue = ButtonActionLiteral | ButtonActionExpression;

export const buttonActionValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
  z.object({ expression: z.string().trim().min(1).max(MAX_FORMULA_LENGTH) }).strict(),
]);

export const buttonActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_property"),
    propertyId: z.string().uuid(),
    value: buttonActionValueSchema,
  }).strict(),
  z.object({
    type: z.literal("set_related_property"),
    relationPropertyId: z.string().uuid(),
    propertyId: z.string().uuid(),
    value: buttonActionValueSchema,
  }).strict(),
  z.object({
    type: z.literal("set_record_property"),
    databaseId: z.string().uuid(),
    recordId: z.string().uuid(),
    propertyId: z.string().uuid(),
    value: buttonActionValueSchema,
  }).strict(),
  z.object({
    type: z.literal("create_record"),
    databaseId: z.string().uuid(),
    title: z.string().trim().min(1).max(200).default("Untitled"),
    values: z.record(z.string().uuid(), buttonActionValueSchema).default({}),
  }).strict(),
]);

export const buttonOptionsSchema = z.object({
  actions: z.array(buttonActionSchema).min(1).max(20),
}).strict();

export type ButtonAction = z.infer<typeof buttonActionSchema>;
export type ButtonRunResult = {
  index: number;
  type: ButtonAction["type"];
  label: string;
  affected: number;
  createdRecordIds?: string[];
};
export type ButtonRunResponse = {
  record: {
    id: string;
    title: string;
    values: Record<string, unknown>;
    pageId: string | null;
    pageCoverImageUrl?: string | null;
    updatedAt?: string;
  };
  relations: Record<string, string[]>;
  results: ButtonRunResult[];
};

export function isButtonWritableProperty(property: { type: string }) {
  return (BUTTON_WRITABLE_PROPERTY_TYPES as readonly string[]).includes(property.type);
}

export function isButtonExpressionWritableProperty(property: { type: string }) {
  return (BUTTON_EXPRESSION_PROPERTY_TYPES as readonly string[]).includes(property.type);
}

export function isButtonActionExpression(value: unknown): value is ButtonActionExpression {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { expression?: unknown }).expression === "string";
}

/**
 * Checks an expression that has been saved on a button: it must parse, and
 * every `{Property}` must name a number property of the button's database.
 */
export function buttonExpressionError(
  expression: string,
  properties: { name: string; type: string }[],
): string | null {
  const parsed = parseFormula(expression);
  if (!parsed.ok) return parsed.error;

  const byName = new Map(properties.map((property) => [property.name, property]));
  for (const name of parsed.references) {
    const property = byName.get(name);
    if (!property) {
      return `Unknown property “${name}”. Use {Property name} to read a current value.`;
    }
    if (property.type !== "number" && property.type !== "rollup" && property.type !== "formula") {
      return `{${name}} is not a number, rollup, or formula property, so it cannot be used in an expression.`;
    }
  }
  return null;
}

/**
 * Evaluates an expression against the record the button runs on. A reference
 * that is missing, not numeric, or a division by zero makes the result null so
 * the runner can refuse to write a wrong number.
 */
export function evaluateButtonExpression(
  expression: string,
  properties: CalculationProperty[],
  record: CalculationRecord,
  targets: RelationTargetMap,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const parsed = parseFormula(expression);
  if (!parsed.ok) return parsed;
  return { ok: true, value: evaluateRecordFormula(parsed.ast, record, properties, targets) };
}

/** The lightweight checks the editor can make before asking the server. */
export function buttonActionsError(actions: ButtonAction[]): string | null {
  if (actions.length === 0) return "Add at least one action to this button.";
  if (actions.some((action) => action.type !== "create_record" && !action.propertyId)) {
    return "Choose a property for every button action.";
  }
  if (actions.some((action) => action.type === "set_related_property" && !action.relationPropertyId)) {
    return "Choose a relation for every linked-record action.";
  }
  if (actions.some((action) => action.type === "set_record_property" && (!action.databaseId || !action.recordId))) {
    return "Choose a database and record for every existing-record action.";
  }
  if (actions.some((action) => action.type === "create_record" && (!action.databaseId || !action.title.trim()))) {
    return "Choose a database and title for every new record.";
  }
  for (const action of actions) {
    const values = action.type === "create_record"
      ? Object.values(action.values)
      : [action.value];
    for (const value of values) {
      if (!isButtonActionExpression(value)) continue;
      const parsed = parseFormula(value.expression);
      if (!parsed.ok) return parsed.error;
    }
  }
  return null;
}

/** A fresh value that matches the target property's editor. */
export function defaultButtonActionValue(type: string): ButtonActionValue {
  if (type === "checkbox") return false;
  if (type === "number") return null;
  if (type === "multi_select") return [];
  return "";
}
