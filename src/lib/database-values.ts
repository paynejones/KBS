export type DatabaseValueProperty = {
  id: string;
  name: string;
  type: string;
  options: Record<string, unknown>;
};

export function validateDatabaseRecordValues(
  values: Record<string, unknown>,
  properties: DatabaseValueProperty[],
): string | null {
  const propertiesById = new Map(properties.map((property) => [property.id, property]));

  for (const [propertyId, value] of Object.entries(values)) {
    const property = propertiesById.get(propertyId);
    if (!property) return "A value references a property that does not belong to this database.";

    switch (property.type) {
      case "text":
      case "url":
      case "date":
        if (value !== null && typeof value !== "string") return `${property.name} must be text.`;
        break;
      case "number":
        if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
          return `${property.name} must be a finite number.`;
        }
        break;
      case "checkbox":
        if (typeof value !== "boolean") return `${property.name} must be checked or unchecked.`;
        break;
      case "select": {
        const choices = Array.isArray(property.options.choices) ? property.options.choices : [];
        if (typeof value !== "string" || (value !== "" && !choices.includes(value))) {
          return `${property.name} must use one of its configured choices.`;
        }
        break;
      }
      case "multi_select": {
        const choices = Array.isArray(property.options.choices) ? property.options.choices : [];
        if (!Array.isArray(value) || value.some((choice) => typeof choice !== "string" || !choices.includes(choice))) {
          return `${property.name} must use configured choices.`;
        }
        break;
      }
      case "relation":
      case "rollup":
        return `${property.name} is managed through its relation or rollup settings.`;
      default:
        return `${property.name} has an unsupported property type.`;
    }
  }

  return null;
}
