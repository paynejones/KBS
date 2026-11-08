import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  databaseProperties,
  databaseRecords,
  databaseViews,
  databases,
} from "@/db/schema";
import { apiErrorResponse } from "@/lib/api-log";
import { dateKey, todayKey } from "@/lib/calendar";
import {
  dueBucket,
  isCompletedStatus,
  isExcludedStatus,
  NO_STATUS_FILTER,
  type DueBucket,
} from "@/lib/dashboard-queues";
import { applyView, parseViewFilters, parseViewSorts } from "@/lib/database-view";

const WIDGET_RECORD_LIMIT = 5;
const QUEUE_RECORD_LIMIT = 5;
const MAX_EXCLUDED_STATUSES = 24;
const MAX_REQUESTED_VIEWS = 6;

/**
 * Home dashboard data. `views` is the picker list of every saved database view;
 * `widgets` contains filtered, sorted previews for the requested view ids.
 * `databases` feeds the due-date and project pickers, and `tasks`/`projects`
 * turn the chosen databases into two working queues over existing records.
 */
export async function GET(request: Request) {
  // Read the URL before the try block: with Cache Components, touching
  // `request.url` is what makes Next.js skip prerendering this GET handler, and
  // it signals that by throwing an internal bailout. Catching it here would log
  // a spurious "Failed to load dashboard widgets" error during every build.
  const searchParams = new URL(request.url).searchParams;
  const viewIds = (searchParams.get("viewIds") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_REQUESTED_VIEWS);
  // The browser sends its own local date so a queue agrees with the calendar
  // the user is looking at; the server date is only a fallback.
  const today = dateKey(searchParams.get("today")) ?? todayKey();
  const taskDatabaseId = searchParams.get("taskDatabaseId")?.trim() ?? "";
  const taskPropertyId = searchParams.get("taskPropertyId")?.trim() ?? "";
  const taskStatusPropertyId = searchParams.get("taskStatusPropertyId")?.trim() ?? "";
  const projectDatabaseId = searchParams.get("projectDatabaseId")?.trim() ?? "";
  const projectPropertyId = searchParams.get("projectPropertyId")?.trim() ?? "";
  const projectExcludedStatuses = searchParams
    .getAll("projectExcludedStatus")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_EXCLUDED_STATUSES);

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

    const databaseOptions = databaseRows.map((database) => ({
      id: database.id,
      name: database.name,
      // Status choices let the project queue offer the values it can skip.
      properties: (propertiesByDatabase.get(database.id) ?? []).map(
        ({ id, name, type, options }) => {
          const choices = Array.isArray(options.choices)
            ? options.choices.filter((choice): choice is string => typeof choice === "string")
            : [];
          return choices.length > 0 ? { id, name, type, choices } : { id, name, type };
        },
      ),
    }));

    const tasks = (() => {
      if (!taskDatabaseId) return null;
      const database = databaseRows.find((row) => row.id === taskDatabaseId);
      if (!database) return null;

      const properties = propertiesByDatabase.get(database.id) ?? [];
      const dateProperty = properties.find(
        (property) => property.id === taskPropertyId && property.type === "date",
      );
      if (!dateProperty) return null;

      // A task database usually carries a status column. Finished records do
      // not belong in a due-soon queue even when their date has already passed.
      // The queue's own choice wins; without one the first status column is
      // used, and an unrecognised choice falls back to it so a deleted property
      // cannot suddenly show finished work.
      const requestedStatus = taskStatusPropertyId
        ? properties.find(
            (property) => property.id === taskStatusPropertyId && property.type === "select",
          )
        : undefined;
      const statusProperty =
        taskStatusPropertyId === NO_STATUS_FILTER
          ? null
          : requestedStatus ?? properties.find((property) => property.type === "select") ?? null;

      const records = (recordsByDatabase.get(database.id) ?? [])
        .flatMap((record) => {
          if (statusProperty && isCompletedStatus(record.values[statusProperty.id])) return [];
          const due = dateKey(record.values[dateProperty.id]);
          const bucket = dueBucket(due, today);
          if (!due || !bucket) return [];
          return [{ id: record.id, title: record.title, due, bucket: bucket as DueBucket }];
        })
        .sort(
          (left, right) =>
            left.due.localeCompare(right.due) ||
            left.title.localeCompare(right.title, undefined, { sensitivity: "base" }),
        );

      return {
        databaseId: database.id,
        databaseName: database.name,
        property: { id: dateProperty.id, name: dateProperty.name },
        statusProperty: statusProperty
          ? { id: statusProperty.id, name: statusProperty.name }
          : null,
        records: records.slice(0, QUEUE_RECORD_LIMIT),
        total: records.length,
        overdue: records.filter((record) => record.bucket === "overdue").length,
      };
    })();

    const projects = (() => {
      if (!projectDatabaseId) return null;
      const database = databaseRows.find((row) => row.id === projectDatabaseId);
      if (!database) return null;

      const properties = propertiesByDatabase.get(database.id) ?? [];
      const requestedStatus = projectPropertyId
        ? properties.find(
            (property) => property.id === projectPropertyId && property.type === "select",
          )
        : undefined;
      // With no property chosen, the first status column defines active work.
      const statusProperty =
        requestedStatus ?? properties.find((property) => property.type === "select") ?? null;

      // A chosen set of statuses replaces the built-in vocabulary; without one
      // the common finish spellings decide what has left the queue.
      const isFinished = (status: unknown) =>
        projectExcludedStatuses.length > 0
          ? isExcludedStatus(status, projectExcludedStatuses)
          : isCompletedStatus(status);

      const records = [...(recordsByDatabase.get(database.id) ?? [])]
        .filter((record) => !isFinished(statusProperty ? record.values[statusProperty.id] : ""))
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .map((record) => {
          const status = statusProperty ? record.values[statusProperty.id] : "";
          return {
            id: record.id,
            title: record.title,
            status: typeof status === "string" ? status : "",
          };
        });

      return {
        databaseId: database.id,
        databaseName: database.name,
        property: statusProperty
          ? { id: statusProperty.id, name: statusProperty.name }
          : null,
        records: records.slice(0, QUEUE_RECORD_LIMIT),
        total: records.length,
      };
    })();

    return NextResponse.json({ views, widgets, databases: databaseOptions, tasks, projects });
  } catch (error) {
    return apiErrorResponse(request, "Failed to load dashboard widgets", error, { status: 500, logMessage: "Failed to load dashboard widgets:" });
  }
}
