import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { databaseProperties, databaseRecords, databases } from "@/db/schema";
import {
  isButtonWritableProperty,
  type ButtonAction,
} from "@/lib/database-button";
import { validateDatabaseRecordValues } from "@/lib/database-values";

/**
 * Checks every target a button action names. Both creating and editing a
 * button use this, so a saved action list cannot drift from the runner's
 * expectations.
 */
export async function validateButtonActionDefinitions(
  databaseId: string,
  actions: ButtonAction[],
): Promise<string | null> {
  const sourceProperties = await db.select().from(databaseProperties)
    .where(eq(databaseProperties.databaseId, databaseId));
  const sourceById = new Map(sourceProperties.map((property) => [property.id, property]));
  const propertiesByDatabase = new Map<string, typeof sourceProperties>([[databaseId, sourceProperties]]);

  for (const action of actions) {
    if (action.type === "create_record") {
      const [targetDatabase] = await db.select({ id: databases.id }).from(databases)
        .where(eq(databases.id, action.databaseId)).limit(1);
      if (!targetDatabase) {
        return "A button action creates a record in a database that does not exist";
      }
      let targetProperties = propertiesByDatabase.get(action.databaseId);
      if (!targetProperties) {
        targetProperties = await db.select().from(databaseProperties)
          .where(eq(databaseProperties.databaseId, action.databaseId));
        propertiesByDatabase.set(action.databaseId, targetProperties);
      }
      const targetById = new Map(targetProperties.map((property) => [property.id, property]));
      for (const [propertyId, value] of Object.entries(action.values)) {
        const target = targetById.get(propertyId);
        if (!target) {
          return "A new record value targets a property outside the chosen database";
        }
        if (!isButtonWritableProperty(target)) {
          return `${target.name} cannot be set when creating a record`;
        }
        const valueError = validateDatabaseRecordValues({ [target.id]: value }, [target]);
        if (valueError) return valueError;
      }
      continue;
    }

    if (action.type === "set_record_property") {
      const [targetDatabase] = await db.select({ id: databases.id }).from(databases)
        .where(eq(databases.id, action.databaseId)).limit(1);
      if (!targetDatabase) {
        return "A button action targets a record in a database that does not exist";
      }
      let targetProperties = propertiesByDatabase.get(action.databaseId);
      if (!targetProperties) {
        targetProperties = await db.select().from(databaseProperties)
          .where(eq(databaseProperties.databaseId, action.databaseId));
        propertiesByDatabase.set(action.databaseId, targetProperties);
      }
      const target = targetProperties.find((property) => property.id === action.propertyId);
      if (!target) {
        return "A button action targets a property outside the chosen database";
      }
      const [targetRecord] = await db.select({ id: databaseRecords.id }).from(databaseRecords)
        .where(and(
          eq(databaseRecords.id, action.recordId),
          eq(databaseRecords.databaseId, action.databaseId),
        ))
        .limit(1);
      if (!targetRecord) return "The chosen record no longer exists";
      if (!isButtonWritableProperty(target)) {
        return `${target.name} cannot be changed by a button`;
      }
      const valueError = validateDatabaseRecordValues({ [target.id]: action.value }, [target]);
      if (valueError) return valueError;
      continue;
    }

    let target;
    if (action.type === "set_property") {
      target = sourceById.get(action.propertyId);
      if (!target) {
        return "A button action targets a property outside this database";
      }
    } else {
      const relation = sourceById.get(action.relationPropertyId);
      const relatedDatabaseId = relation?.options.relatedDatabaseId;
      if (!relation || relation.type !== "relation" || typeof relatedDatabaseId !== "string") {
        return "A button action needs a relation from this database";
      }
      let related = propertiesByDatabase.get(relatedDatabaseId);
      if (!related) {
        related = await db.select().from(databaseProperties)
          .where(eq(databaseProperties.databaseId, relatedDatabaseId));
        propertiesByDatabase.set(relatedDatabaseId, related);
      }
      target = related.find((property) => property.id === action.propertyId);
      if (!target) {
        return "A button action targets a property outside the related database";
      }
    }

    if (!isButtonWritableProperty(target)) {
      return `${target.name} cannot be changed by a button`;
    }
    const valueError = validateDatabaseRecordValues({ [target.id]: action.value }, [target]);
    if (valueError) return valueError;
  }

  return null;
}
