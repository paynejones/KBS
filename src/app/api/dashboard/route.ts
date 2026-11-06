import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  databaseProperties,
  databaseRecords,
  databaseViews,
  databases,
} from "@/db/schema";
import { applyView, parseViewFilters, parseViewSorts } from "@/lib/database-view";

const WIDGET_RECORD_LIMIT = 5;
const MAX_REQUESTED_VIEWS = 6;

/**
 * Home dashboard data. `views` is the picker list of every saved database view;
 * `widgets` contains filtered, sorted previews for the requested view ids.
 */
export async function GET(request: Request) {
  // Read the URL before the try block: with Cache Components, touching
  // `request.url` is what makes Next.js skip prerendering this GET handler, and
  // it signals that by throwing an internal bailout. Catching it here would log
  // a spurious "Failed to load dashboard widgets" error during every build.
  const viewIds = (new URL(request.url).searchParams.get("viewIds") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_REQUESTED_VIEWS);

  try {
    const [databaseRows, propertyRows, recordRows, viewRows] = await Promise.all([
      db.select({ id: databases.id, name: databases.name }).from(databases).orderBy(asc(databases.name)),
      db.select().from(databaseProperties).orderBy(asc(databaseProperties.sortOrder)),
      db.select().from(databaseRecords).orderBy(asc(databaseRecords.sortOrder)),
      db.select().from(databaseViews).orderBy(asc(databaseViews.sortOrder)),
    ]);

    const databaseNames = new Map(databaseRows.map((database) => [database.id, database.name]));

    const propertiesByDatabase = new Map<string, typeof propertyRows>();
    for (const property of propertyRows) {
      propertiesByDatabase.set(property.databaseId, [
        ...(propertiesByDatabase.get(property.databaseId) ?? []),
        property,
      ]);
    }

    const recordsByDatabase = new Map<string, typeof recordRows>();
    for (const record of recordRows) {
      recordsByDatabase.set(record.databaseId, [
        ...(recordsByDatabase.get(record.databaseId) ?? []),
        record,
      ]);
    }

    const views = viewRows
      .filter((view) => databaseNames.has(view.databaseId))
      .map((view) => ({
        id: view.id,
        name: view.name,
        type: view.type,
        databaseId: view.databaseId,
        databaseName: databaseNames.get(view.databaseId) ?? "",
      }));

    const widgets = viewIds.flatMap((viewId) => {
      const view = viewRows.find((candidate) => candidate.id === viewId);
      if (!view) return [];

      const properties = propertiesByDatabase.get(view.databaseId) ?? [];
      const records = recordsByDatabase.get(view.databaseId) ?? [];
      const visible = applyView(
        records,
        properties,
        parseViewFilters(view.config),
        parseViewSorts(view.config),
      );

      return [{
        view: {
          id: view.id,
          name: view.name,
          type: view.type,
          config: view.config,
          databaseId: view.databaseId,
          databaseName: databaseNames.get(view.databaseId) ?? "",
        },
        properties: properties.map(({ id, name, type }) => ({ id, name, type })),
        records: visible.slice(0, WIDGET_RECORD_LIMIT).map((record) => ({
          id: record.id,
          title: record.title,
          values: record.values,
          pageId: record.pageId,
        })),
        total: visible.length,
      }];
    });

    return NextResponse.json({ views, widgets });
  } catch (error) {
    console.error("Failed to load dashboard widgets:", error);
    return NextResponse.json({ error: "Failed to load dashboard widgets" }, { status: 500 });
  }
}
