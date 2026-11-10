import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  databaseProperties,
  databaseRecordRelations,
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
import {
  chartData,
  chartDateWindow,
  chartSeries,
  chartDatePresetWindow,
  parseChartDateBound,
  parseChartDateOffset,
  parseChartDatePreset,
  parseChartType,
} from "@/lib/database-chart";
import {
  formulaValue,
  rollupValue,
  type CalculationProperty,
  type RelationTargetMap,
} from "@/lib/database-calculations";
import { applyView, parseViewFilters, parseViewSorts } from "@/lib/database-view";
import {
  parseTimelineRange,
  sortTimelineEntries,
  TIMELINE_ENTRY_LIMIT,
  timelineWindow,
  type TimelineEntry,
} from "@/lib/timeline";

const WIDGET_RECORD_LIMIT = 5;
const QUEUE_RECORD_LIMIT = 5;
const MAX_EXCLUDED_STATUSES = 24;
const MAX_REQUESTED_VIEWS = 6;

/**
 * Home dashboard data. `views` is the picker list of every saved database view;
 * `widgets` contains filtered, sorted previews for the requested view ids.
 * `databases` feeds the due-date and project pickers, and `tasks`/`projects`
 * turn the chosen databases into two working queues over existing records.
 * `timeline` (only when requested) merges every database's dated records into
 * one chronological view.
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
  const timelineRequested = searchParams.get("timeline") === "1";
  const timelineRange = parseTimelineRange(searchParams.get("timelineDays"));

  try {
    const [databaseRows, propertyRows, recordRows, viewRows, relationRows] = await Promise.all([
      db.select({ id: databases.id, name: databases.name }).from(databases).orderBy(asc(databases.name)),
      db.select().from(databaseProperties).orderBy(asc(databaseProperties.sortOrder)),
      db.select().from(databaseRecords).orderBy(asc(databaseRecords.sortOrder)),
      db.select().from(databaseViews).orderBy(asc(databaseViews.sortOrder)),
      db.select().from(databaseRecordRelations),
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

    const relationsByRecord = new Map<string, Record<string, string[]>>();
    for (const relation of relationRows) {
      const recordRelations = relationsByRecord.get(relation.sourceRecordId) ?? {};
      recordRelations[relation.propertyId] = [
        ...(recordRelations[relation.propertyId] ?? []),
        relation.targetRecordId,
      ];
      relationsByRecord.set(relation.sourceRecordId, recordRelations);
    }

    // Chart widgets resolve formulas and rollups the same way the database page
    // does, so a calculated column charts the number it displays.
    const relationTargets: RelationTargetMap = {};
    for (const database of databaseRows) {
      for (const property of propertiesByDatabase.get(database.id) ?? []) {
        if (property.type !== "relation") continue;
        const relatedId = property.options.relatedDatabaseId;
        if (typeof relatedId !== "string") continue;
        relationTargets[property.id] = {
          properties: (propertiesByDatabase.get(relatedId) ?? []) as unknown as CalculationProperty[],
          records: (recordsByDatabase.get(relatedId) ?? []).map(({ id, values }) => ({ id, values })),
        };
      }
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
      const records = (recordsByDatabase.get(view.databaseId) ?? []).map((record) => ({
        ...record,
        relations: relationsByRecord.get(record.id) ?? {},
      }));
      const valueFor = (
        record: (typeof records)[number],
        property: { id: string; type: string },
      ) => {
        const calculationProperty = property as unknown as CalculationProperty;
        if (property.type === "rollup") {
          return rollupValue(record, calculationProperty, relationTargets);
        }
        if (property.type === "formula") {
          return formulaValue(
            record,
            calculationProperty,
            properties as unknown as CalculationProperty[],
            relationTargets,
          );
        }
        return record.values[property.id];
      };
      const visible = applyView(
        records,
        properties,
        parseViewFilters(view.config),
        parseViewSorts(view.config),
        { valueFor },
      );

      // A chart widget keeps the view's saved shape and is computed from every
      // record the view includes, not from the five-record list preview.
      const chart = (() => {
        if (view.type !== "chart") return null;
        const numeric = properties.filter((property) =>
          property.type === "number" || property.type === "formula" || property.type === "rollup",
        );
        const propertyId = typeof view.config.chartPropertyId === "string"
          ? view.config.chartPropertyId
          : "";
        const property = numeric.find((candidate) => candidate.id === propertyId) ?? numeric[0];
        if (!property) return null;

        const groupId = typeof view.config.chartGroupPropertyId === "string"
          ? view.config.chartGroupPropertyId
          : "";
        const group = properties.find((candidate) =>
          candidate.id === groupId && candidate.type === "select",
        );
        const choices = group && Array.isArray(group.options.choices)
          ? group.options.choices.filter((choice): choice is string => typeof choice === "string")
          : [];
        const dateId = typeof view.config.chartDatePropertyId === "string"
          ? view.config.chartDatePropertyId
          : "";
        const dateProperty = properties.find((candidate) =>
          candidate.id === dateId && candidate.type === "date",
        );
        const dateRange = parseTimelineRange(view.config.chartDateRange);
        const dateOffset = parseChartDateOffset(view.config.chartDateOffset);
        const dateStart = parseChartDateBound(view.config.chartDateStart);
        const dateEnd = parseChartDateBound(view.config.chartDateEnd);
        const datePreset = parseChartDatePreset(view.config.chartDatePreset);
        const dateWindow = dateProperty
          ? chartDateWindow(today, dateRange, dateOffset, dateStart, dateEnd, datePreset)
          : null;
        const presetWindow = datePreset
          ? chartDatePresetWindow(today, datePreset)
          : null;
        const valueProperty = { id: property.id, name: property.name, type: property.type };
        const groupProperty = group
          ? { id: group.id, name: group.name, type: group.type, options: { choices } }
          : null;
        // Chart data keeps only in-window values but returns an outside count
        // per group, so a slice's total and its excluded records agree.
        const bars = chartData(visible, valueProperty, {
          valueFor,
          groupBy: groupProperty,
          dateProperty,
          dateWindow,
        });
        const type = parseChartType(view.config.chartType);

        return {
          type,
          property: { id: property.id, name: property.name, type: property.type },
          groupProperty: group ? { id: group.id, name: group.name } : null,
          dateProperty: dateProperty
            ? { id: dateProperty.id, name: dateProperty.name, type: dateProperty.type }
            : null,
          dateRange,
          dateOffset,
          dateStart: presetWindow?.from ?? dateStart,
          dateEnd: presetWindow?.to ?? dateEnd,
          datePreset,
          chart: bars,
          // A widget can switch shape in place, so every chart widget carries
          // the line points even while another shape is saved.
          series: chartSeries(visible, valueProperty, {
            valueFor,
            dateProperty: dateProperty
              ? { id: dateProperty.id, name: dateProperty.name, type: dateProperty.type }
              : null,
            dateWindow,
          }),
        };
      })();

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
        chart,
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

    // Every date property can contribute, so the timeline crosses databases
    // without any per-database setup.
    const timeline = (() => {
      if (!timelineRequested) return null;
      const bounds = timelineWindow(today, timelineRange);
      if (!bounds) return null;

      const entries: TimelineEntry[] = [];
      let dateProperties = 0;
      for (const database of databaseRows) {
        const datedProperties = (propertiesByDatabase.get(database.id) ?? [])
          .filter((property) => property.type === "date");
        dateProperties += datedProperties.length;
        if (datedProperties.length === 0) continue;

        const records = recordsByDatabase.get(database.id) ?? [];
        for (const property of datedProperties) {
          for (const record of records) {
            const date = dateKey(record.values[property.id]);
            if (!date || date < bounds.from || date > bounds.to) continue;
            entries.push({
              recordId: record.id,
              title: record.title,
              databaseId: database.id,
              databaseName: database.name,
              propertyId: property.id,
              propertyName: property.name,
              date,
            });
          }
        }
      }

      const sorted = sortTimelineEntries(entries);
      return {
        today,
        range: timelineRange,
        from: bounds.from,
        to: bounds.to,
        dateProperties,
        entries: sorted.slice(0, TIMELINE_ENTRY_LIMIT),
        total: sorted.length,
      };
    })();

    return NextResponse.json({ views, widgets, databases: databaseOptions, tasks, projects, timeline });
  } catch (error) {
    return apiErrorResponse(request, "Failed to load dashboard widgets", error, { status: 500, logMessage: "Failed to load dashboard widgets:" });
  }
}
