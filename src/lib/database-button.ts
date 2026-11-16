import { z } from "zod";
import { dateKey } from "@/lib/calendar";
import {
  type CalculationProperty,
  type CalculationRecord,
  evaluateRecordFormula,
  referenceValue,
  type RelationTargetMap,
} from "@/lib/database-calculations";
import { MAX_FORMULA_LENGTH, parseFormula, type FormulaNode } from "@/lib/database-formula";
import { shiftDateKey } from "@/lib/timeline";

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
 * A date target reads that record's date properties as well, so `{Due} + 7`
 * moves a date by whole days while the formula language itself stays numeric.
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
 * every `{Property}` must name a number property of the button's database. A
 * date target can also name that record's date properties, which is how a
 * button copies or shifts a date.
 */
export function buttonExpressionError(
  expression: string,
  properties: { name: string; type: string }[],
  targetType?: string,
): string | null {
  const dateTarget = targetType === "date";
  const parsed = parseFormula(expression, { allowToday: dateTarget });
  if (!parsed.ok) return parsed.error;

  const byName = new Map(properties.map((property) => [property.name, property]));
  for (const name of parsed.references) {
    const property = byName.get(name);
    if (!property) {
      return `Unknown property “${name}”. Use {Property name} to read a current value.`;
    }
    const readable = property.type === "number"
      || property.type === "rollup"
      || property.type === "formula"
      || (dateTarget && property.type === "date");
    if (!readable) {
      return dateTarget
        ? `{${name}} is not a date, number, rollup, or formula property, so it cannot be used in an expression.`
        : `{${name}} is not a number, rollup, or formula property, so it cannot be used in an expression.`;
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

type DateExpressionValue =
  | { kind: "date"; key: string }
  | { kind: "number"; value: number };

export type ButtonDateExpressionResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Evaluates an expression written for a date property. A date can be copied
 * from another date property or moved by whole days (`{Due} + 7`,
 * `{Due} - {Snooze days}`), or start from `today()`; the difference between two
 * dates is a day count. Numbers keep the arithmetic a formula has, so a day
 * count can be calculated on the way, but the final value must be a date. A
 * blank reference makes the whole expression blank rather than writing a wrong
 * date. `today` is injectable so a test can pin the day away from midnight.
 */
export function evaluateButtonDateExpression(
  expression: string,
  properties: CalculationProperty[],
  record: CalculationRecord,
  targets: RelationTargetMap,
  today: string = dateKey(new Date()) ?? "",
): ButtonDateExpressionResult {
  const parsed = parseFormula(expression, { allowToday: true });
  if (!parsed.ok) return parsed;

  type Evaluated = { ok: true; value: DateExpressionValue | null } | { ok: false; error: string };
  const byName = new Map(properties.map((property) => [property.name, property]));
  const numberValue = (value: number): Evaluated => ({ ok: true, value: { kind: "number", value } });

  const shift = (key: string, days: number): Evaluated => {
    if (!Number.isFinite(days) || !Number.isInteger(days)) {
      return { ok: false, error: "A date can only move by a whole number of days." };
    }
    const shifted = shiftDateKey(key, days);
    return { ok: true, value: shifted ? { kind: "date", key: shifted } : null };
  };

  const evaluate = (node: FormulaNode): Evaluated => {
    switch (node.kind) {
      case "number":
        return numberValue(node.value);
      case "reference": {
        const property = byName.get(node.name);
        if (!property) {
          return { ok: false, error: `Unknown property “${node.name}”. Use {Property name} to read a current value.` };
        }
        if (property.type === "date") {
          const key = dateKey(record.values[property.id]);
          return { ok: true, value: key ? { kind: "date", key } : null };
        }
        if (property.type === "number" || property.type === "rollup" || property.type === "formula") {
          const value = referenceValue(node.name, record, properties, targets);
          return { ok: true, value: value === null ? null : { kind: "number", value } };
        }
        return {
          ok: false,
          error: `{${node.name}} is not a date, number, rollup, or formula property, so it cannot be used in an expression.`,
        };
      }
      case "unary": {
        const operand = evaluate(node.operand);
        if (!operand.ok || operand.value === null) return operand;
        if (operand.value.kind === "date") {
          return { ok: false, error: "A date cannot be negated." };
        }
        return numberValue(node.operator === "-" ? -operand.value.value : operand.value.value);
      }
      case "binary": {
        const left = evaluate(node.left);
        if (!left.ok) return left;
        const right = evaluate(node.right);
        if (!right.ok) return right;
        if (left.value === null || right.value === null) return { ok: true, value: null };
        const a = left.value;
        const b = right.value;
        if (node.operator === "+") {
          if (a.kind === "number" && b.kind === "number") return numberValue(a.value + b.value);
          if (a.kind === "date" && b.kind === "number") return shift(a.key, b.value);
          if (a.kind === "number" && b.kind === "date") return shift(b.key, a.value);
          return { ok: false, error: "Two dates cannot be added. Add or subtract whole days instead, e.g. {Due} + 7." };
        }
        if (node.operator === "-") {
          if (a.kind === "number" && b.kind === "number") return numberValue(a.value - b.value);
          if (a.kind === "date" && b.kind === "number") return shift(a.key, -b.value);
          if (a.kind === "date" && b.kind === "date") {
            const days = (Date.parse(`${a.key}T00:00:00Z`) - Date.parse(`${b.key}T00:00:00Z`)) / 86_400_000;
            return numberValue(days);
          }
          return { ok: false, error: "A number cannot have a date subtracted from it." };
        }
        if (a.kind === "number" && b.kind === "number") {
          if (node.operator === "*") return numberValue(a.value * b.value);
          return b.value === 0 ? { ok: true, value: null } : numberValue(a.value / b.value);
        }
        return { ok: false, error: "Dates cannot be multiplied or divided. Add or subtract whole days instead." };
      }
      case "call": {
        if (node.name === "today") {
          return { ok: true, value: today ? { kind: "date", key: today } : null };
        }
        const args: number[] = [];
        for (const argument of node.args) {
          const evaluated = evaluate(argument);
          if (!evaluated.ok) return evaluated;
          if (evaluated.value === null) return { ok: true, value: null };
          if (evaluated.value.kind === "date") {
            return { ok: false, error: "round() needs numbers, not a date." };
          }
          args.push(evaluated.value.value);
        }
        const digits = args.length === 1 ? 0 : Math.min(Math.max(args[1], 0), 6);
        const factor = 10 ** digits;
        return numberValue(Math.round(args[0] * factor) / factor);
      }
      default:
        return { ok: false, error: "This expression cannot be evaluated as a date." };
    }
  };

  const evaluated = evaluate(parsed.ast);
  if (!evaluated.ok) return evaluated;
  if (evaluated.value === null) return { ok: true, value: null };
  if (evaluated.value.kind !== "date") {
    return {
      ok: false,
      error: "This expression computed a number, not a date. Add or subtract whole days from a date property, e.g. {Due} + 7.",
    };
  }
  return { ok: true, value: evaluated.value.key };
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
      // The target's type is not known here, so `today()` is accepted and the
      // target-aware checks reject it when the property is not a date.
      const parsed = parseFormula(value.expression, { allowToday: true });
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
