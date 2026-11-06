/**
 * Database formulas are small arithmetic expressions over other properties, for
 * example `{Episodes watched} / {Episodes total} * 100`. They support the four
 * operators, parentheses, numeric literals, `{Property}` references, and
 * `round(value, digits)`. Everything else is rejected rather than evaluated, so
 * a stored formula cannot run arbitrary code.
 */

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

const SUPPORTED_FUNCTIONS = new Set(["round"]);

class FormulaParser {
  private position = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

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

    if (args.length < 1 || args.length > 2) return "round() takes a value and an optional number of digits.";
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

export function parseFormula(expression: string): FormulaParseResult {
  const trimmed = expression.trim();
  if (!trimmed) return { ok: false, error: "Enter a formula." };
  if (trimmed.length > MAX_FORMULA_LENGTH) {
    return { ok: false, error: `Keep formulas under ${MAX_FORMULA_LENGTH} characters.` };
  }

  const tokenized = tokenize(trimmed);
  if (!tokenized.ok) return tokenized;

  return new FormulaParser(tokenized.tokens).parse();
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** Math.min(Math.max(digits, 0), MAX_ROUND_DIGITS);
  return Math.round(value * factor) / factor;
}

/**
 * Evaluates against a resolver that returns a number for each referenced
 * property. A missing, non-numeric, or divided-by-zero value makes the whole
 * formula blank instead of silently showing a wrong number.
 */
export function evaluateFormula(
  ast: FormulaNode,
  resolve: (name: string) => number | null,
): number | null {
  switch (ast.kind) {
    case "number":
      return Number.isFinite(ast.value) ? ast.value : null;
    case "reference": {
      const value = resolve(ast.name);
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    }
    case "unary": {
      const operand = evaluateFormula(ast.operand, resolve);
      if (operand === null) return null;
      return ast.operator === "-" ? -operand : operand;
    }
    case "binary": {
      const left = evaluateFormula(ast.left, resolve);
      const right = evaluateFormula(ast.right, resolve);
      if (left === null || right === null) return null;
      switch (ast.operator) {
        case "+": return left + right;
        case "-": return left - right;
        case "*": return left * right;
        case "/": return right === 0 ? null : left / right;
      }
      return null;
    }
    case "call": {
      const value = evaluateFormula(ast.args[0], resolve);
      if (value === null) return null;
      if (ast.args.length === 1) return roundTo(value, 0);
      const digits = evaluateFormula(ast.args[1], resolve);
      return digits === null ? null : roundTo(value, digits);
    }
    default:
      return null;
  }
}

/** Formula cells render as plain numbers, with a dash when they cannot be computed. */
export function formatFormulaValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = roundTo(value, MAX_ROUND_DIGITS);
  return String(rounded);
}
