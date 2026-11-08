/** CSV import helpers: parse a file, map its columns to properties, and build record values. */

export const MAX_CSV_ROWS = 2000;
const MAX_PROPERTY_NAME_LENGTH = 120;
const MAX_TITLE_LENGTH = 200;
const IMPORTABLE_TYPES = new Set(["text", "number", "checkbox", "date", "url", "select", "multi_select"]);
const SKIP = Symbol("skip");

export type CsvImportProperty = {
  id: string;
  name: string;
  type: string;
  options: Record<string, unknown>;
};

export type CsvColumn = {
  /** A property id, or `new:<lowercased header>` for a column that creates a property. */
  key: string;
  index: number;
  type: string;
  choices: string[];
};

export type CsvColumnPlan = {
  titleIndex: number;
  columns: CsvColumn[];
  newPropertyNames: string[];
  ignoredColumns: string[];
};

export type CsvParseResult =
  | { ok: true; headers: string[]; rows: string[][] }
  | { ok: false; error: string };

export type CsvRecordsResult = {
  records: { title: string; values: Record<string, unknown> }[];
  skippedRows: number;
  skippedCells: number;
};

/** Parses RFC 4180-style CSV, tolerating a BOM, CRLF or LF line endings, and blank lines. */
export function parseCsv(text: string): CsvParseResult {
  const input = text.replace(/^\uFEFF/, "");
  if (!input.trim()) return { ok: false, error: "The CSV file is empty." };

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  function endField() {
    row.push(field);
    field = "";
  }

  function endRow() {
    endField();
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
  }

  while (index < input.length) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (character === '"' && field === "") {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === ",") {
      endField();
      index += 1;
      continue;
    }
    if (character === "\r") {
      if (input[index + 1] === "\n") index += 1;
      endRow();
      index += 1;
      continue;
    }
    if (character === "\n") {
      endRow();
      index += 1;
      continue;
    }
    field += character;
    index += 1;
  }

  if (quoted) return { ok: false, error: "The CSV file has an unclosed quote." };
  endRow();

  const [headers, ...data] = rows;
  if (!headers || headers.every((header) => header.trim() === "")) {
    return { ok: false, error: "The CSV needs a header row." };
  }
  return { ok: true, headers: headers.map((header) => header.trim()), rows: data };
}

function choicesOf(options: Record<string, unknown>) {
  const choices = options.choices;
  return Array.isArray(choices) ? choices.filter((choice): choice is string => typeof choice === "string") : [];
}

/**
 * Maps CSV columns onto existing properties by name. Unmatched columns create a
 * text property, while computed and file columns cannot be imported and are
 * reported as ignored. Without a Name column the first column becomes the title.
 */
export function planCsvColumns(headers: string[], properties: CsvImportProperty[]): CsvColumnPlan {
  const foundTitleIndex = headers.findIndex((header) => /^(name|title)$/i.test(header.trim()));
  const titleIndex = foundTitleIndex === -1 ? 0 : foundTitleIndex;
  const propertiesByName = new Map(properties.map((property) => [property.name.trim().toLocaleLowerCase(), property]));
  const seen = new Set<string>();
  const columns: CsvColumn[] = [];
  const newPropertyNames: string[] = [];
  const ignoredColumns: string[] = [];

  headers.forEach((header, index) => {
    if (index === titleIndex) return;
    const name = header.trim();
    if (!name) return;
    const key = name.toLocaleLowerCase();
    if (key === "linked page" || seen.has(key)) {
      ignoredColumns.push(name);
      return;
    }
    seen.add(key);
    const property = propertiesByName.get(key);
    if (property) {
      if (!IMPORTABLE_TYPES.has(property.type)) {
        ignoredColumns.push(name);
        return;
      }
      columns.push({ key: property.id, index, type: property.type, choices: choicesOf(property.options) });
      return;
    }
    newPropertyNames.push(name.slice(0, MAX_PROPERTY_NAME_LENGTH));
    columns.push({ key: `new:${key}`, index, type: "text", choices: [] });
  });

  return { titleIndex, columns, newPropertyNames, ignoredColumns };
}

function convertCell(column: CsvColumn, raw: string): unknown {
  switch (column.type) {
    case "number": {
      const numeric = Number(raw);
      return Number.isFinite(numeric) ? numeric : SKIP;
    }
    case "checkbox": {
      if (/^(yes|true|1|checked|x)$/i.test(raw)) return true;
      if (/^(no|false|0|unchecked)$/i.test(raw)) return false;
      return SKIP;
    }
    case "select":
      return column.choices.length === 0 || column.choices.includes(raw) ? raw : SKIP;
    case "multi_select": {
      const picked = raw.split("|").map((entry) => entry.trim()).filter(Boolean);
      const allowed = picked.filter((entry) => column.choices.length === 0 || column.choices.includes(entry));
      return allowed.length > 0 ? allowed : SKIP;
    }
    default:
      return raw;
  }
}

/** Builds importable records. `propertyIds` maps every column key to its saved property id. */
export function buildCsvRecords(
  rows: string[][],
  plan: CsvColumnPlan,
  propertyIds: ReadonlyMap<string, string>,
): CsvRecordsResult {
  const records: CsvRecordsResult["records"] = [];
  let skippedRows = 0;
  let skippedCells = 0;

  for (const row of rows) {
    const title = (plan.titleIndex >= 0 ? row[plan.titleIndex] ?? "" : "").trim().slice(0, MAX_TITLE_LENGTH);
    const values: Record<string, unknown> = {};
    let hasValue = false;

    for (const column of plan.columns) {
      const propertyId = propertyIds.get(column.key);
      if (!propertyId) continue;
      const raw = (row[column.index] ?? "").trim();
      if (raw === "") continue;
      hasValue = true;
      const converted = convertCell(column, raw);
      if (converted === SKIP) {
        skippedCells += 1;
        continue;
      }
      values[propertyId] = converted;
    }

    if (!title && !hasValue) {
      skippedRows += 1;
      continue;
    }
    records.push({ title: title || "Untitled", values });
  }

  return { records, skippedRows, skippedCells };
}
