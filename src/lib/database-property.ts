/**
 * Every property type the API accepts, in the order the database UI lists them,
 * so the route, the type unions, and the add-property menu cannot drift.
 */
export const DATABASE_PROPERTY_TYPES = [
  "text",
  "number",
  "checkbox",
  "date",
  "url",
  "select",
  "multi_select",
  "relation",
  "rollup",
  "formula",
  "file",
  "button",
] as const;

export type DatabasePropertyType = (typeof DATABASE_PROPERTY_TYPES)[number];

/** Every aggregation a rollup may use, so the API and the editor agree. */
export const ROLLUP_AGGREGATIONS = ["count", "sum", "average", "min", "max"] as const;
export type RollupAggregation = (typeof ROLLUP_AGGREGATIONS)[number];

/** How many labels a Select or Multi-select property may offer. */
export const MAX_PROPERTY_CHOICES = 100;

/** A saved property's choices, dropping anything that is not a usable label. */
export function propertyChoices(options: Record<string, unknown> | undefined): string[] {
  const raw = options?.choices;
  if (!Array.isArray(raw)) return [];
  return raw.filter((choice): choice is string => typeof choice === "string" && choice.trim() !== "");
}

/**
 * Appends new labels to a property's choices. Adding is append-only on purpose:
 * a stored record value names its choice, so removing or renaming one would
 * leave rows pointing at a label the property no longer offers.
 */
export function mergePropertyChoices(existing: string[], added: string[]): string[] {
  const choices = [...existing];
  for (const choice of added) {
    const trimmed = choice.trim();
    if (trimmed && !choices.includes(trimmed)) choices.push(trimmed);
  }
  return choices;
}

/** A label is required for every type, so adding one cannot leave the menu short. */
export const DATABASE_PROPERTY_TYPE_LABELS: Record<DatabasePropertyType, string> = {
  text: "Text",
  number: "Number",
  checkbox: "Checkbox",
  date: "Date",
  url: "URL",
  select: "Select",
  multi_select: "Multi-select",
  relation: "Relation",
  rollup: "Rollup",
  formula: "Formula",
  file: "File",
  button: "Button",
};
