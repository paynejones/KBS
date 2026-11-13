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
