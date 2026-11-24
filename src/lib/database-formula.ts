/**
 * Database formulas are small expressions over other properties, for example
 * `{Episodes watched} / {Episodes total} * 100` or `{Due} - today()`. A value is
 * a number, a date key (`YYYY-MM-DD`, the way a date property stores one), or
 * blank. Formulas support the four operators, parentheses, numeric literals,
 * `{Property}` references, `round(value, digits)`, `dateAdd(date, days)`,
 * `daysBetween(start, end)`, and `today()`. A date moves by whole days with `+`
 * and `-`, and subtracting two dates gives a day count. Everything else is
 * rejected rather than evaluated, so a stored formula cannot run arbitrary code.
 */

import { todayKey } from "@/lib/calendar";

export const MAX_FORMULA_LENGTH = 500;
const MAX_FORMULA_DEPTH = 32;
const MAX_ROUND_DIGITS = 6;

export type FormulaNode =
  | { kind: "number"; value: number }
  | { kind: "reference"; name: string }
  | { kind: "unary"; operator: "-" | "+"; operand: FormulaNode }
  | { kind: "binary"; operator: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode }
  | { kind: "call"; name: string; args: FormulaNode[] };

export type FormulaParseResult =
  | { ok: true; references: string[]; ast: FormulaNode }
  | { ok: false; error: string };

/** `today()` is only meaningful where dates are written, so it is opt-in. */
export type FormulaOptions = { allowToday?: boolean };

/**
 * What a formula computes: a number, a date key, or blank. Dates stay as the
 * `YYYY-MM-DD` keys date properties store, so filters, sorts, and other
 * formulas read them as dates instead of as formatted text.
 */
export type FormulaValue = number | string | null;

/** The day `today()` resolves to; tests pin it instead of reading the clock. */
export type FormulaEvaluationOptions = { today?: string };

type Token =
  | { type: "number"; value: number }
  | { type: "reference"; name: string }
  | { type: "name"; name: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma" };

type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; error: string };

function tokenize(expression: string): TokenizeResult {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const character = expression[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === "{") {
      const end = expression.indexOf("}", index + 1);
      if (end === -1) return { ok: false, error: "Unclosed {property} reference." };
      const name = expression.slice(index + 1, end).trim();
      if (!name) return { ok: false, error: "Property references cannot be empty." };
      tokens.push({ type: "reference", name });
      index = end + 1;
      continue;
    }

    if (character === "}" ) {
      return { ok: false, error: "Unexpected closing brace." };
    }

    if (/[0-9]/.test(character) || (character === "." && /[0-9]/.test(expression[index + 1] ?? ""))) {
      const match = /^\d*\.?\d+/.exec(expression.slice(index));
      if (!match) return { ok: false, error: "Invalid number." };
      tokens.push({ type: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }

    if (/[A-Za-z_]/.test(character)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expression.slice(index))!;
      tokens.push({ type: "name", name: match[0] });
      index += match[0].length;
      continue;
    }

    if (character === "+" || character === "-" || character === "*" || character === "/") {
      tokens.push({ type: "operator", value: character });
      index += 1;
      continue;
    }

    if (character === "(" || character === ")") {
      tokens.push({ type: "paren", value: character });
      index += 1;
      continue;
    }

    if (character === ",") {
      tokens.push({ type: "comma" });
      index += 1;
      continue;
    }

    return { ok: false, error: `Unexpected character “${character}”.` };
  }

  return { ok: true, tokens };
}

const FUNCTION_ARITY: Record<string, { min: number; max: number; error: string }> = {
  round: { min: 1, max: 2, error: "round() takes a value and an optional number of digits." },
  dateAdd: { min: 2, max: 2, error: "dateAdd() takes a date and a whole number of days." },
  daysBetween: { min: 2, max: 2, error: "daysBetween() takes a start date and an end date." },
};

const SUPPORTED_FUNCTIONS = new Set(Object.keys(FUNCTION_ARITY));

class FormulaParser {
  private position = 0;
  private depth = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly options: FormulaOptions = {},
  ) {}

  parse(): FormulaParseResult {
    if (this.tokens.length === 0) return { ok: false, error: "Enter a formula." };

    const expression = this.parseExpression();
    if (typeof expression === "string") return { ok: false, error: expression };

    if (this.position < this.tokens.length) {
      return { ok: false, error: "Unexpected input after the formula." };
    }

    return { ok: true, references: collectReferences(expression), ast: expression };
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private parseExpression(): FormulaNode | string {
    let left = this.parseTerm();
    if (typeof left === "string") return left;

    while (true) {
      const token = this.peek();
      if (token?.type !== "operator" || (token.value !== "+" && token.value !== "-")) break;
      this.position += 1;
      const right = this.parseTerm();
      if (typeof right === "string") return right;
      left = { kind: "binary", operator: token.value, left, right };
    }

    return left;
  }

  private parseTerm(): FormulaNode | string {
    let left = this.parseUnary();
    if (typeof left === "string") return left;

    while (true) {
      const token = this.peek();
      if (token?.type !== "operator" || (token.value !== "*" && token.value !== "/")) break;
      this.position += 1;
      const right = this.parseUnary();
      if (typeof right === "string") return right;
      left = { kind: "binary", operator: token.value, left, right };
    }

    return left;
  }

  private parseUnary(): FormulaNode | string {
    const token = this.peek();
    if (token?.type === "operator" && (token.value === "+" || token.value === "-")) {
      this.position += 1;
      if (this.depth += 1, this.depth > MAX_FORMULA_DEPTH) return "This formula is nested too deeply.";
      const operand = this.parseUnary();
      this.depth -= 1;
      if (typeof operand === "string") return operand;
      return { kind: "unary", operator: token.value, operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaNode | string {
    const token = this.peek();
    if (!token) return "The formula ends before a value.";

    if (token.type === "number") {
      this.position += 1;
      return { kind: "number", value: token.value };
    }

    if (token.type === "reference") {
      this.position += 1;
      return { kind: "reference", name: token.name };
    }

    if (token.type === "name") {
      this.position += 1;
      return this.parseCall(token.name);
    }

    if (token.type === "paren" && token.value === "(") {
      this.position += 1;
      if (this.depth += 1, this.depth > MAX_FORMULA_DEPTH) return "This formula is nested too deeply.";
      const inner = this.parseExpression();
      this.depth -= 1;
      if (typeof inner === "string") return inner;
      const closing = this.peek();
      if (closing?.type !== "paren" || closing.value !== ")") return "Unclosed parenthesis.";
      this.position += 1;
      return inner;
    }

    return "The formula is missing a number or {property}.";
  }

  private parseCall(name: string): FormulaNode | string {
    if (name === "today") {
      if (!this.options.allowToday) {
        return "Unknown function “today”. Use {Property} to reference a property.";
      }
      const opening = this.peek();
      if (opening?.type !== "paren" || opening.value !== "(") {
        return "today() needs parentheses: write today().";
      }
      this.position += 1;
      const closing = this.peek();
      if (closing?.type !== "paren" || closing.value !== ")") {
        return "today() takes no arguments.";
      }
      this.position += 1;
      return { kind: "call", name, args: [] };
    }

    if (!SUPPORTED_FUNCTIONS.has(name)) {
      return `Unknown function “${name}”. Use {Property} to reference a property.`;
    }

    const opening = this.peek();
    if (opening?.type !== "paren" || opening.value !== "(") {
      return `Unknown function “${name}”. Wrap values in round(…) to round them.`;
    }
    this.position += 1;

    const args: FormulaNode[] = [];
    const first = this.peek();
    if (first?.type !== "paren" || first.value !== ")") {
      while (true) {
        if (this.depth += 1, this.depth > MAX_FORMULA_DEPTH) return "This formula is nested too deeply.";
        const argument = this.parseExpression();
        this.depth -= 1;
        if (typeof argument === "string") return argument;
        args.push(argument);

        const separator = this.peek();
        if (separator?.type === "comma") {
          this.position += 1;
          continue;
        }
        break;
      }
    }

    const closing = this.peek();
    if (closing?.type !== "paren" || closing.value !== ")") return "Unclosed parenthesis.";
    this.position += 1;

    const arity = FUNCTION_ARITY[name];
    if (args.length < arity.min || args.length > arity.max) return arity.error;
    return { kind: "call", name, args };
  }
}

function collectReferences(node: FormulaNode, references: string[] = []): string[] {
  switch (node.kind) {
    case "reference":
      if (!references.includes(node.name)) references.push(node.name);
      break;
    case "unary":
      collectReferences(node.operand, references);
      break;
    case "binary":
      collectReferences(node.left, references);
      collectReferences(node.right, references);
      break;
    case "call":
      for (const argument of node.args) collectReferences(argument, references);
      break;
    default:
      break;
  }
  return references;
}

export function parseFormula(
  expression: string,
  options: FormulaOptions = {},
): FormulaParseResult {
  const trimmed = expression.trim();
  if (!trimmed) return { ok: false, error: "Enter a formula." };
  if (trimmed.length > MAX_FORMULA_LENGTH) {
    return { ok: false, error: `Keep formulas under ${MAX_FORMULA_LENGTH} characters.` };
  }

  const tokenized = tokenize(trimmed);
  if (!tokenized.ok) return tokenized;

  return new FormulaParser(tokenized.tokens, options).parse();
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** Math.min(Math.max(digits, 0), MAX_ROUND_DIGITS);
  return Math.round(value * factor) / factor;
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/;

/** True for a stored date key, the only string a formula treats as a date. */
export function isFormulaDateKey(value: unknown): value is string {
  return typeof value === "string" && DATE_KEY_PATTERN.test(value.trim());
}

/** The `YYYY-MM-DD` part of a stored date, or null when it is not a date. */
function dateKeyOf(value: unknown): string | null {
  const match = typeof value === "string" ? DATE_KEY_PATTERN.exec(value.trim()) : null;
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** Whole days only, so a fractional day count blanks instead of jumping a date. */
function shiftDateKey(key: string, days: number): string | null {
  if (!Number.isInteger(days)) return null;
  const [year, month, day] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  if (Number.isNaN(shifted.getTime())) return null;
  return shifted.toISOString().slice(0, 10);
}

function daysBetweenKeys(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * Evaluates against a resolver that returns a number or date for each
 * referenced property. A missing value, an operation that a value's type does
 * not allow, or a division by zero makes the whole formula blank instead of
 * silently showing a wrong answer.
 */
export function evaluateFormula(
  ast: FormulaNode,
  resolve: (name: string) => FormulaValue,
  options: FormulaEvaluationOptions = {},
): FormulaValue {
  const today = options.today ?? todayKey();

  const evaluate = (node: FormulaNode): FormulaValue => {
    switch (node.kind) {
      case "number":
        return Number.isFinite(node.value) ? node.value : null;
      case "reference": {
        const value = resolve(node.name);
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        return dateKeyOf(value);
      }
      case "unary": {
        const operand = evaluate(node.operand);
        if (typeof operand !== "number") return null;
        return node.operator === "-" ? -operand : operand;
      }
      case "binary": {
        const left = evaluate(node.left);
        const right = evaluate(node.right);
        if (left === null || right === null) return null;

        if (typeof left === "number" && typeof right === "number") {
          switch (node.operator) {
            case "+": return left + right;
            case "-": return left - right;
            case "*": return left * right;
            case "/": return right === 0 ? null : left / right;
          }
        }

        // A date moves by whole days: `{Due} + 7`, `{Due} - {Snooze days}`.
        const leftDate = dateKeyOf(left);
        const rightDate = dateKeyOf(right);
        if (node.operator === "+") {
          if (leftDate && typeof right === "number") return shiftDateKey(leftDate, right);
          if (typeof left === "number" && rightDate) return shiftDateKey(rightDate, left);
          return null;
        }
        if (node.operator === "-") {
          if (leftDate && typeof right === "number") return shiftDateKey(leftDate, -right);
          // `{Due} - today()` counts days from today to the due date.
          if (leftDate && rightDate) return daysBetweenKeys(rightDate, leftDate);
        }
        return null;
      }
      case "call": {
        const args = node.args.map(evaluate);
        if (args.some((value) => value === null)) return null;

        switch (node.name) {
          case "today":
            return today;
          case "round": {
            const value = args[0];
            const digits = args.length === 1 ? 0 : args[1];
            if (typeof value !== "number" || typeof digits !== "number") return null;
            return roundTo(value, digits);
          }
          case "dateAdd": {
            const date = dateKeyOf(args[0]);
            return date && typeof args[1] === "number" ? shiftDateKey(date, args[1]) : null;
          }
          case "daysBetween": {
            const start = dateKeyOf(args[0]);
            const end = dateKeyOf(args[1]);
            return start && end ? daysBetweenKeys(start, end) : null;
          }
          default:
            return null;
        }
      }
      default:
        return null;
    }
  };

  return evaluate(ast);
}

/** Formula cells render numbers compactly and dates as a short calendar day. */
export function formatFormulaValue(value: FormulaValue): string {
  if (typeof value === "string") {
    const key = dateKeyOf(value);
    if (!key) return "—";
    const date = new Date(`${key}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return key;
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = roundTo(value, MAX_ROUND_DIGITS);
  return String(rounded);
}
