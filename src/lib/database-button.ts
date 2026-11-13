import { z } from "zod";

/**
 * Button actions are deliberately small: a button may write a literal value to
 * a property on its own record, to records already linked through one of the
 * database's relation properties, to one existing record chosen by the user, or
 * create one new record in a chosen database with literal initial values.
 * Buttons cannot run expressions or write properties they do not own.
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

export type ButtonActionValue = string | number | boolean | string[] | null;

const buttonActionValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
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
  return null;
}

/** A fresh value that matches the target property's editor. */
export function defaultButtonActionValue(type: string): ButtonActionValue {
  if (type === "checkbox") return false;
  if (type === "number") return null;
  if (type === "multi_select") return [];
  return "";
}
