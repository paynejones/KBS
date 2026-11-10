import type { ViewProperty, ViewRecord } from "./database-view";

export type ListValue = {
  id: string;
  name: string;
  display: string;
};

export type ListRow = {
  id: string;
  title: string;
  pageId: string | null;
  values: ListValue[];
};

type ListRecord = ViewRecord & { pageId?: string | null };

/** A stored value as one readable line; empty values are left for the caller. */
export function formatListValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((item) => formatListValue(item)).filter(Boolean).join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Turns view records into compact list rows. Calculated properties can be read
 * through `valueFor` so a rollup or formula lists the number the user sees,
 * and blank values are dropped unless the caller asks for every property.
 */
export function listRows<T extends ListRecord>(
  records: readonly T[],
  properties: readonly ViewProperty[],
  options?: {
    valueFor?: (record: T, property: ViewProperty) => unknown;
    limit?: number;
    hideEmpty?: boolean;
  },
): ListRow[] {
  const valueFor =
    options?.valueFor ?? ((record: T, property: ViewProperty) => record.values[property.id]);
  const limit = Math.max(0, options?.limit ?? properties.length);
  const hideEmpty = options?.hideEmpty ?? true;

  return records.map((record) => {
    const values: ListValue[] = [];
    for (const property of properties.slice(0, limit)) {
      const display = formatListValue(valueFor(record, property));
      if (hideEmpty && display === "") continue;
      values.push({ id: property.id, name: property.name, display });
    }

    return {
      id: record.id,
      title: record.title?.trim() || "Untitled",
      pageId: record.pageId ?? null,
      values,
    };
  });
}
