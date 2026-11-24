import { todayKey } from "@/lib/calendar";

/** Every view type the API accepts, so the route and the database UI cannot drift. */
export const DATABASE_VIEW_TYPES = [
  "table",
  "board",
  "gallery",
  "calendar",
  "list",
  "timeline",
  "chart",
] as const;

export type DatabaseViewType = (typeof DATABASE_VIEW_TYPES)[number];

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
  /** The day a relative date filter resolves against; tests pin it. */
  today?: string;
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

/** Gallery card densities; only a gallery view reads this. */
export const GALLERY_CARD_SIZES = ["small", "medium", "large"] as const;
export type GalleryCardSize = (typeof GALLERY_CARD_SIZES)[number];

/**
 * A gallery saved before the size choice existed has no `cardSize`, so it keeps
 * the medium grid it was drawn with. Unknown values fall back the same way.
 */
export function parseGalleryCardSize(
  config: Record<string, unknown> | undefined,
): GalleryCardSize {
  const raw = config?.cardSize;
  return typeof raw === "string" && (GALLERY_CARD_SIZES as readonly string[]).includes(raw)
    ? (raw as GalleryCardSize)
    : "medium";
}

export function operatorsForProperty(type: string): ViewFilterOperator[] {
  switch (type) {
    case "number":
    // A rollup resolves to a number, so it compares like one.
    case "rollup":
      return ["is", "is_not", "greater_than", "less_than", "is_empty", "is_not_empty"];
    case "formula":
      // A formula may compute a number or a date, so it offers both comparisons
      // and decides which one a filter uses from the values it finds.
      return [
        "is",
        "is_not",
        "greater_than",
        "less_than",
        "before",
        "after",
        "is_empty",
        "is_not_empty",
      ];
    case "date":
      return ["is", "is_not", "before", "after", "is_empty", "is_not_empty"];
    case "checkbox":
      return ["is_checked", "is_not_checked"];
    case "select":
      return ["is", "is_not", "contains", "does_not_contain", "is_empty", "is_not_empty"];
    case "multi_select":
      return ["contains", "does_not_contain", "is_empty", "is_not_empty"];
    // A relation filter names a record, so "is" means "is linked to".
    case "relation":
      return ["is", "is_not", "is_empty", "is_not_empty"];
    default:
      return ["contains", "does_not_contain", "is", "is_not", "is_empty", "is_not_empty"];
  }
}

export function isFilterableProperty(type: string) {
  // A file value is an attachment object rather than text or a number, so it
  // is the one type a view cannot filter on.
  return type !== "file";
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

/** The records a relation links to. `valueFor` supplies them as an id array. */
function linkedRecordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => stringValue(entry).toLocaleLowerCase()).filter(Boolean);
}

/**
 * "Empty" differs by type: a rollup with nothing to sum renders a dash rather
 * than a blank, and a relation holds ids instead of a value.
 */
function isEmptyFor(property: ViewProperty, value: unknown): boolean {
  if (property.type === "rollup") return numberValue(value) === null;
  if (property.type === "relation") return linkedRecordIds(value).length === 0;
  return isEmptyValue(value);
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

/** A date filter may say "today" instead of a fixed day, so it stays current. */
export function isRelativeDateValue(value: string): boolean {
  return value.trim().toLocaleLowerCase() === "today";
}

function resolveDateTarget(value: string, today: string): string | null {
  return isRelativeDateValue(value) ? today : dateValue(value);
}

/**
 * A filter only applies once it can actually be evaluated: no value yet, or a
 * value that does not parse as the property's type, leaves the view unchanged.
 */
function isFilterActive(
  filter: ViewFilter,
  property: ViewProperty,
  today: string,
): boolean {
  if (!filterNeedsValue(filter.operator)) return true;
  if (filter.value.trim() === "") return false;

  if (property.type === "formula") {
    if (filter.operator === "before" || filter.operator === "after") {
      return resolveDateTarget(filter.value, today) !== null;
    }
    if (filter.operator === "is" || filter.operator === "is_not") {
      // `is 3` compares numbers; `is today` or `is 2026-11-23` compares dates.
      return numberValue(filter.value) !== null
        || resolveDateTarget(filter.value, today) !== null;
    }
    return numberValue(filter.value) !== null;
  }
  if ((property.type === "number" || property.type === "rollup")
    && ["is", "is_not", "greater_than", "less_than"].includes(filter.operator)) {
    return numberValue(filter.value) !== null;
  }
  if (property.type === "date" && ["is", "is_not", "before", "after"].includes(filter.operator)) {
    return resolveDateTarget(filter.value, today) !== null;
  }
  return true;
}

/** A filter's value is resolved once per view, not once per record. */
type ResolvedFilter = {
  filter: ViewFilter;
  needle: string;
  dateTarget: string | null;
};

function matchesFilter(
  property: ViewProperty,
  resolved: ResolvedFilter,
  value: unknown,
): boolean {
  const { filter, needle, dateTarget } = resolved;

  switch (filter.operator) {
    case "is_empty":
      return isEmptyFor(property, value);
    case "is_not_empty":
      return !isEmptyFor(property, value);
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
      if (property.type === "relation") return linkedRecordIds(value).includes(needle);
      if (property.type === "multi_select") return selectedValues(value).includes(needle);
      if (property.type === "formula") {
        // A formula decides its own type from the value it computed.
        const currentDate = dateValue(value);
        if (dateTarget !== null && currentDate !== null) return currentDate === dateTarget;
        const current = numberValue(value);
        const target = numberValue(filter.value);
        return current !== null && target !== null && current === target;
      }
      if (property.type === "number" || property.type === "rollup") {
        const current = numberValue(value);
        const target = numberValue(filter.value);
        return current !== null && target !== null && current === target;
      }
      if (property.type === "date") {
        const current = dateValue(value);
        return current !== null && dateTarget !== null && current === dateTarget;
      }
      return stringValue(value).toLocaleLowerCase() === needle;
    case "is_not":
      if (property.type === "relation") return !linkedRecordIds(value).includes(needle);
      if (property.type === "multi_select") return !selectedValues(value).includes(needle);
      if (property.type === "formula") {
        const currentDate = dateValue(value);
        if (dateTarget !== null && currentDate !== null) return currentDate !== dateTarget;
        const current = numberValue(value);
        const target = numberValue(filter.value);
        return !(current !== null && target !== null && current === target);
      }
      if (property.type === "number" || property.type === "rollup") {
        const current = numberValue(value);
        const target = numberValue(filter.value);
        return !(current !== null && target !== null && current === target);
      }
      if (property.type === "date") {
        const current = dateValue(value);
        return !(current !== null && dateTarget !== null && current === dateTarget);
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
      return current !== null && dateTarget !== null && current < dateTarget;
    }
    case "after": {
      const current = dateValue(value);
      return current !== null && dateTarget !== null && current > dateTarget;
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
  const today = options?.today ?? todayKey();
  const active: ResolvedFilter[] = [];
  for (const filter of filters) {
    const property = propertiesById.get(filter.propertyId);
    if (!property || !isFilterActive(filter, property, today)) continue;

    active.push({
      filter,
      needle: filter.value.trim().toLocaleLowerCase(),
      dateTarget: property.type === "date" || property.type === "formula"
        ? resolveDateTarget(filter.value, today)
        : null,
    });
  }

  if (active.length === 0) return records;

  return records.filter((record) => active.every((resolved) => {
    const property = propertiesById.get(resolved.filter.propertyId)!;
    return matchesFilter(property, resolved, valueFor(record, property));
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

/**
 * The properties a view chose to show, or null when it shows them all. A saved
 * list is untrusted JSON, so duplicates and non-strings are dropped; an empty
 * list is deliberate and leaves the view with only its record titles.
 */
export function parseVisibleProperties(
  config: Record<string, unknown> | undefined,
): string[] | null {
  const raw = config?.visibleProperties;
  if (!Array.isArray(raw)) return null;

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string" || !entry || seen.has(entry)) continue;
    seen.add(entry);
    ids.push(entry);
    if (ids.length >= 200) break;
  }

  return ids;
}

/** Properties in database order, keeping only the ones the view shows. */
export function visiblePropertyList<T extends { id: string }>(
  properties: T[],
  config: Record<string, unknown> | undefined,
): T[] {
  const ids = parseVisibleProperties(config);
  if (!ids) return properties;

  const shown = new Set(ids);
  return properties.filter((property) => shown.has(property.id));
}

const VIEW_NAME_LIMIT = 100;

/** "Watchlist" becomes "Watchlist copy", trimmed to the stored name limit. */
export function appendedViewName(name: string): string {
  const base = name.trim() || "View";
  const suffix = " copy";
  return `${base.slice(0, VIEW_NAME_LIMIT - suffix.length).trimEnd()}${suffix}`;
}

/** Swaps a view with its neighbor and leaves boundary moves untouched. */
export function reorderedViewIds(
  viewIds: string[],
  viewId: string,
  direction: "left" | "right",
): string[] {
  const index = viewIds.indexOf(viewId);
  if (index === -1) return viewIds;

  const target = direction === "left" ? index - 1 : index + 1;
  if (target < 0 || target >= viewIds.length) return viewIds;

  const next = [...viewIds];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
