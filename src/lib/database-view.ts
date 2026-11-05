export const FILTER_OPERATORS = {
  contains: "contains",
  does_not_contain: "does not contain",
  is: "is",
  is_not: "is not",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  greater_than: "is greater than",
  less_than: "is less than",
  before: "is before",
  after: "is after",
  is_checked: "is checked",
  is_not_checked: "is not checked",
} as const;

export type ViewFilterOperator = keyof typeof FILTER_OPERATORS;

export type ViewFilter = {
  id: string;
  propertyId: string;
  operator: ViewFilterOperator;
  value: string;
};

export type ViewSort = {
  propertyId: string;
  direction: "asc" | "desc";
};

export type ViewProperty = {
  id: string;
  name: string;
  type: string;
};

export type ViewRecord = {
  id: string;
  title: string;
  values: Record<string, unknown>;
};

type ValueOptions<T extends ViewRecord> = {
  valueFor?: (record: T, property: ViewProperty) => unknown;
};

const MAX_FILTERS = 12;
const MAX_SORTS = 3;

export const DEFAULT_VIEW_SORTS: ViewSort[] = [{ propertyId: "title", direction: "asc" }];

const OPERATOR_KEYS = new Set<string>(Object.keys(FILTER_OPERATORS));

/** Filters saved on a view are untrusted JSON, so parse them defensively. */
export function parseViewFilters(config: Record<string, unknown> | undefined): ViewFilter[] {
  const raw = config?.filters;
  if (!Array.isArray(raw)) return [];

  const filters: ViewFilter[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { id, propertyId, operator, value } = entry as Partial<ViewFilter>;

    if (typeof propertyId !== "string" || !propertyId) continue;
    if (typeof operator !== "string" || !OPERATOR_KEYS.has(operator)) continue;

    filters.push({
      id: typeof id === "string" && id ? id : `${propertyId}:${filters.length}`,
      propertyId,
      operator: operator as ViewFilterOperator,
      value: typeof value === "string" ? value : "",
    });

    if (filters.length >= MAX_FILTERS) break;
  }

  return filters;
}

/** Sorts saved on a view are untrusted JSON, so parse them defensively. */
export function parseViewSorts(config: Record<string, unknown> | undefined): ViewSort[] {
  const raw = config?.sorts;
  if (!Array.isArray(raw)) return DEFAULT_VIEW_SORTS;

  const sorts: ViewSort[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { propertyId, direction } = entry as Partial<ViewSort>;

    if (typeof propertyId !== "string" || !propertyId || seen.has(propertyId)) continue;
    seen.add(propertyId);
    sorts.push({ propertyId, direction: direction === "desc" ? "desc" : "asc" });

    if (sorts.length >= MAX_SORTS) break;
  }

  return sorts.length > 0 ? sorts : DEFAULT_VIEW_SORTS;
}

export function operatorsForProperty(type: string): ViewFilterOperator[] {
  switch (type) {
    case "number":
      return ["is", "is_not", "greater_than", "less_than", "is_empty", "is_not_empty"];
    case "date":
      return ["is", "is_not", "before", "after", "is_empty", "is_not_empty"];
    case "checkbox":
      return ["is_checked", "is_not_checked"];
    case "select":
      return ["is", "is_not", "contains", "does_not_contain", "is_empty", "is_not_empty"];
    case "multi_select":
      return ["contains", "does_not_contain", "is_empty", "is_not_empty"];
    default:
      return ["contains", "does_not_contain", "is", "is_not", "is_empty", "is_not_empty"];
  }
}

export function isFilterableProperty(type: string) {
  return type !== "relation" && type !== "rollup" && type !== "file";
}

export function filterNeedsValue(operator: ViewFilterOperator) {
  return operator !== "is_empty" && operator !== "is_not_empty"
    && operator !== "is_checked" && operator !== "is_not_checked";
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => stringValue(item)).join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function selectedValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item).trim().toLocaleLowerCase()).filter(Boolean);
  }
  return stringValue(value).split(",").map((item) => item.trim().toLocaleLowerCase()).filter(Boolean);
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === ""
    || (Array.isArray(value) && value.length === 0);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = stringValue(value).trim();
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function dateValue(value: unknown): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(stringValue(value).trim());
  return match ? match[0] : null;
}

/**
 * A filter only applies once it can actually be evaluated: no value yet, or a
 * value that does not parse as the property's type, leaves the view unchanged.
 */
function isFilterActive(filter: ViewFilter, property: ViewProperty): boolean {
  if (!filterNeedsValue(filter.operator)) return true;
  if (filter.value.trim() === "") return false;

  if (property.type === "number" && ["is", "is_not", "greater_than", "less_than"].includes(filter.operator)) {
    return numberValue(filter.value) !== null;
  }
  if (property.type === "date" && ["is", "is_not", "before", "after"].includes(filter.operator)) {
    return dateValue(filter.value) !== null;
  }
  return true;
}

function matchesFilter(
  property: ViewProperty,
  filter: ViewFilter,
  value: unknown,
): boolean {
  const needle = filter.value.trim().toLocaleLowerCase();

  switch (filter.operator) {
    case "is_empty":
      return isEmptyValue(value);
    case "is_not_empty":
      return !isEmptyValue(value);
    case "is_checked":
      return value === true;
    case "is_not_checked":
      return value !== true;
    case "contains":
      return property.type === "multi_select"
        ? selectedValues(value).includes(needle)
        : stringValue(value).toLocaleLowerCase().includes(needle);
    case "does_not_contain":
      return property.type === "multi_select"
        ? !selectedValues(value).includes(needle)
        : !stringValue(value).toLocaleLowerCase().includes(needle);
    case "is":
      if (property.type === "multi_select") return selectedValues(value).includes(needle);
      if (property.type === "number") {
        const current = numberValue(value);
        const target = numberValue(filter.value);
        return current !== null && target !== null && current === target;
      }
      if (property.type === "date") {
        const current = dateValue(value);
        const target = dateValue(filter.value);
        return current !== null && target !== null && current === target;
      }
      return stringValue(value).toLocaleLowerCase() === needle;
    case "is_not":
      if (property.type === "multi_select") return !selectedValues(value).includes(needle);
      if (property.type === "number") {
        const current = numberValue(value);
        const target = numberValue(filter.value);
        return !(current !== null && target !== null && current === target);
      }
      if (property.type === "date") {
        const current = dateValue(value);
        const target = dateValue(filter.value);
        return !(current !== null && target !== null && current === target);
      }
      return stringValue(value).toLocaleLowerCase() !== needle;
    case "greater_than": {
      const current = numberValue(value);
      const target = numberValue(filter.value);
      return current !== null && target !== null && current > target;
    }
    case "less_than": {
      const current = numberValue(value);
      const target = numberValue(filter.value);
      return current !== null && target !== null && current < target;
    }
    case "before": {
      const current = dateValue(value);
      const target = dateValue(filter.value);
      return current !== null && target !== null && current < target;
    }
    case "after": {
      const current = dateValue(value);
      const target = dateValue(filter.value);
      return current !== null && target !== null && current > target;
    }
    default:
      return true;
  }
}

/**
 * Applies every filter with AND semantics. Filters that point at a missing
 * property are ignored so a deleted property cannot hide a whole view, and a
 * filter whose value has not been entered yet is treated as inactive.
 */
export function filterRecords<T extends ViewRecord>(
  records: T[],
  properties: ViewProperty[],
  filters: ViewFilter[],
  options?: ValueOptions<T>,
): T[] {
  if (filters.length === 0) return records;

  const propertiesById = new Map(properties.map((property) => [property.id, property]));
  const valueFor = options?.valueFor ?? ((record: T, property: ViewProperty) => record.values[property.id]);
  const active = filters.filter((filter) => {
    const property = propertiesById.get(filter.propertyId);
    return property ? isFilterActive(filter, property) : false;
  });

  if (active.length === 0) return records;

  return records.filter((record) => active.every((filter) => {
    const property = propertiesById.get(filter.propertyId)!;
    return matchesFilter(property, filter, valueFor(record, property));
  }));
}

function compareValues(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return stringValue(left).localeCompare(stringValue(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/** Sorts by the first rule that distinguishes two records, like a spreadsheet. */
export function sortRecords<T extends ViewRecord>(
  records: T[],
  properties: ViewProperty[],
  sorts: ViewSort[],
  options?: ValueOptions<T>,
): T[] {
  if (sorts.length === 0) return records;

  const propertiesById = new Map(properties.map((property) => [property.id, property]));
  const valueFor = options?.valueFor ?? ((record: T, property: ViewProperty) => record.values[property.id]);

  return [...records].sort((left, right) => {
    for (const sort of sorts) {
      const property = propertiesById.get(sort.propertyId);
      if (!property && sort.propertyId !== "title") continue;

      const leftValue = sort.propertyId === "title" ? left.title : valueFor(left, property!);
      const rightValue = sort.propertyId === "title" ? right.title : valueFor(right, property!);
      const comparison = compareValues(leftValue, rightValue);

      if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
    }
    return 0;
  });
}

export function applyView<T extends ViewRecord>(
  records: T[],
  properties: ViewProperty[],
  filters: ViewFilter[],
  sorts: ViewSort[],
  options?: ValueOptions<T>,
): T[] {
  return sortRecords(filterRecords(records, properties, filters, options), properties, sorts, options);
}
