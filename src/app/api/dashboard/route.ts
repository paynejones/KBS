import { asc, eq, inArray, sql } from "drizzle-orm";
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

// Scope ids are compared against uuid columns, so a malformed one has to be
// dropped at the edge instead of turning a bad query string into a 500.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrEmpty = (value: string) => (uuidPattern.test(value) ? value : "");

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
    .filter((value) => value !== "" && uuidPattern.test(value))
    .slice(0, MAX_REQUESTED_VIEWS);
  // The browser sends its own local date so a queue agrees with the calendar
  // the user is looking at; the server date is only a fallback.
  const today = dateKey(searchParams.get("today")) ?? todayKey();
  const taskDatabaseId = uuidOrEmpty(searchParams.get("taskDatabaseId")?.trim() ?? "");
  const taskPropertyId = searchParams.get("taskPropertyId")?.trim() ?? "";
  const taskStatusPropertyId = searchParams.get("taskStatusPropertyId")?.trim() ?? "";
  const projectDatabaseId = uuidOrEmpty(searchParams.get("projectDatabaseId")?.trim() ?? "");
  const projectPropertyId = searchParams.get("projectPropertyId")?.trim() ?? "";
  const projectExcludedStatuses = searchParams
    .getAll("projectExcludedStatus")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_EXCLUDED_STATUSES);
  const timelineRequested = searchParams.get("timeline") === "1";
  const timelineRange = parseTimelineRange(searchParams.get("timelineDays"));

  try {
    const [databaseRows, propertyRows, viewRows] = await Promise.all([
      db.select({ id: databases.id, name: databases.name }).from(databases).orderBy(asc(databases.name)),
      // The pickers list every database with its properties, so choosing one
      // can offer its date and status fields without another request.
      db.select().from(databaseProperties).orderBy(asc(databaseProperties.sortOrder)),
      // The picker lists every view, but a view's saved config is only read
      // for the views this request actually previews (below).
      db.select({
        id: databaseViews.id,
        name: databaseViews.name,
        type: databaseViews.type,
        databaseId: databaseViews.databaseId,
      }).from(databaseViews).orderBy(asc(databaseViews.sortOrder)),
    ]);

    const databaseNames = new Map(databaseRows.map((database) => [database.id, database.name]));

    // Only the databases this request reads are loaded whole, and only a pinned
    // view needs that: filters, charts and derived columns can read any property
    // of a record. A queue reads a date and a status, and the timeline reads
    // dates, so both take the narrow read built below.
    const loadedDatabaseIds = new Set<string>();
    for (const view of viewRows) {
      if (viewIds.includes(view.id)) loadedDatabaseIds.add(view.databaseId);
    }

    const queueDatabaseIds = new Set<string>();
    if (taskDatabaseId) queueDatabaseIds.add(taskDatabaseId);
    if (projectDatabaseId) queueDatabaseIds.add(projectDatabaseId);

    // The timeline spans every database because any date property can
    // contribute, but it only ever looks at date values.
    const timelineDatabaseIds = new Set<string>(
      timelineRequested ? databaseRows.map((database) => database.id) : [],
    );

    // A rollup or formula reads through its relation, so the databases on the
    // other side of that relation join the scope even though nothing on the
    // page names them.
    const targetDatabaseIds = new Set<string>();
    for (const property of propertyRows) {
      if (property.type !== "relation" || !loadedDatabaseIds.has(property.databaseId)) continue;
      const relatedId = property.options.relatedDatabaseId;
      if (typeof relatedId === "string" && !loadedDatabaseIds.has(relatedId)) {
        targetDatabaseIds.add(relatedId);
      }
    }

    // A database that a view or a rollup also needs is already read whole, so
    // only the queue- or timeline-only ones get the narrow read.
    const projectedQueueIds = new Set(
      [...queueDatabaseIds].filter(
        (databaseId) =>
          !loadedDatabaseIds.has(databaseId) && !targetDatabaseIds.has(databaseId),
      ),
    );
    const projectedTimelineIds = new Set(
      [...timelineDatabaseIds].filter(
        (databaseId) =>
          !loadedDatabaseIds.has(databaseId) && !targetDatabaseIds.has(databaseId),
      ),
    );
    const projectedDatabaseIds = [...new Set([...projectedQueueIds, ...projectedTimelineIds])];

    const recordDatabaseIds = [...new Set([...loadedDatabaseIds, ...targetDatabaseIds])];
    const calculatedProperties = propertyRows.filter(
      (property) =>
        loadedDatabaseIds.has(property.databaseId) || targetDatabaseIds.has(property.databaseId),
    );

    // Relations only matter to a calculation, and then only from the records
    // this request loaded, so a dashboard of plain views reads none of them.
    const needsRelations = calculatedProperties.some(
      (property) =>
        property.type === "relation" || property.type === "rollup" || property.type === "formula",
    );

    const [recordRows, viewConfigRows, relationRows] = await Promise.all([
      recordDatabaseIds.length === 0
        ? []
        : db
            .select()
            .from(databaseRecords)
            .where(inArray(databaseRecords.databaseId, recordDatabaseIds))
            .orderBy(asc(databaseRecords.sortOrder)),
      viewIds.length === 0
        ? []
        : db
            .select({ id: databaseViews.id, config: databaseViews.config })
            .from(databaseViews)
            .where(inArray(databaseViews.id, viewIds)),
      needsRelations && recordDatabaseIds.length > 0
        ? db
            .select()
            .from(databaseRecordRelations)
            .where(
              inArray(
                databaseRecordRelations.sourceRecordId,
                db
                  .select({ id: databaseRecords.id })
                  .from(databaseRecords)
                  .where(inArray(databaseRecords.databaseId, recordDatabaseIds)),
              ),
            )
        : [],
    ]);

    const viewConfigs = new Map(viewConfigRows.map((view) => [view.id, view.config]));

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

    /** The fields a preview reads: its title, its page, when it changed, and the
     *  date and status values — not every property of every record. */
    type PreviewRecordRow = {
      id: string;
      title: string;
      pageId: string | null;
      updatedAt: Date;
      values: Record<string, unknown>;
    };

    const projectedRows = new Map<string, PreviewRecordRow[]>();
    await Promise.all(
      projectedDatabaseIds.map(async (databaseId) => {
        // The timeline only asks for dates; a queue also asks for a status.
        const wantsSelects = projectedQueueIds.has(databaseId);
        const previewProperties = (propertiesByDatabase.get(databaseId) ?? []).filter(
          (property) => property.type === "date" || (wantsSelects && property.type === "select"),
        );
        // Only the values a preview can look at travel; text, files, relations
        // and derived columns stay in the database, unread.
        const values = previewProperties.length === 0
          ? sql<Record<string, unknown>>`'{}'::jsonb`
          : sql<Record<string, unknown>>`jsonb_build_object(${sql.join(
              previewProperties.flatMap((property) => [
                sql`${property.id}::text`,
                sql`${databaseRecords.values}->>${property.id}`,
              ]),
              sql`, `,
            )})`;

        const rows = await db
          .select({
            id: databaseRecords.id,
            title: databaseRecords.title,
            pageId: databaseRecords.pageId,
            updatedAt: databaseRecords.updatedAt,
            values,
          })
          .from(databaseRecords)
          .where(eq(databaseRecords.databaseId, databaseId));

        projectedRows.set(databaseId, rows);
      }),
    );

    /** A queue or the timeline reads through here: whole records when a view also
     *  needs them, otherwise the narrow read of just the values it looks at. */
    const previewRecords = (databaseId: string): PreviewRecordRow[] =>
      recordsByDatabase.get(databaseId) ?? projectedRows.get(databaseId) ?? [];

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
    for (const property of propertyRows) {
      if (property.type !== "relation") continue;
      const relatedId = property.options.relatedDatabaseId;
      if (typeof relatedId !== "string") continue;
      relationTargets[property.id] = {
        properties: (propertiesByDatabase.get(relatedId) ?? []) as unknown as CalculationProperty[],
        records: (recordsByDatabase.get(relatedId) ?? []).map(({ id, values }) => ({ id, values })),
      };
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

      const config = viewConfigs.get(view.id) ?? {};
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
            today,
          );
        }
        // A relation filter on a pinned widget reads the record's links.
        if (property.type === "relation") return record.relations[property.id] ?? [];
        return record.values[property.id];
      };
      // The widget is filtered in the browser's day, not the server's, so a
      // "today" filter agrees with the widgets that render around it.
      const visible = applyView(
        records,
        properties,
        parseViewFilters(config),
        parseViewSorts(config),
        { valueFor, today },
      );

      // A chart widget keeps the view's saved shape and is computed from every
      // record the view includes, not from the five-record list preview.
      const chart = (() => {
        if (view.type !== "chart") return null;
        const numeric = properties.filter((property) =>
          property.type === "number" || property.type === "formula" || property.type === "rollup",
        );
        const propertyId = typeof config.chartPropertyId === "string"
          ? config.chartPropertyId
          : "";
        const property = numeric.find((candidate) => candidate.id === propertyId) ?? numeric[0];
        if (!property) return null;

        const groupId = typeof config.chartGroupPropertyId === "string"
          ? config.chartGroupPropertyId
          : "";
        const group = properties.find((candidate) =>
          candidate.id === groupId && candidate.type === "select",
        );
        const choices = group && Array.isArray(group.options.choices)
          ? group.options.choices.filter((choice): choice is string => typeof choice === "string")
          : [];
        const dateId = typeof config.chartDatePropertyId === "string"
          ? config.chartDatePropertyId
          : "";
        const dateProperty = properties.find((candidate) =>
          candidate.id === dateId && candidate.type === "date",
        );
        const dateRange = parseTimelineRange(config.chartDateRange);
        const dateOffset = parseChartDateOffset(config.chartDateOffset);
        const dateStart = parseChartDateBound(config.chartDateStart);
        const dateEnd = parseChartDateBound(config.chartDateEnd);
        const datePreset = parseChartDatePreset(config.chartDatePreset);
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
        const type = parseChartType(config.chartType);

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
          config,
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

      const records = previewRecords(database.id)
        .flatMap((record) => {
          if (statusProperty && isCompletedStatus(record.values[statusProperty.id])) return [];
          const due = dateKey(record.values[dateProperty.id]);
          const bucket = dueBucket(due, today);
          if (!due || !bucket) return [];
          return [{ id: record.id, title: record.title, due, bucket: bucket as DueBucket, pageId: record.pageId }];
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

      const records = [...previewRecords(database.id)]
        .filter((record) => !isFinished(statusProperty ? record.values[statusProperty.id] : ""))
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .map((record) => {
          const status = statusProperty ? record.values[statusProperty.id] : "";
          return {
            id: record.id,
            title: record.title,
            status: typeof status === "string" ? status : "",
            pageId: record.pageId,
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

        const records = previewRecords(database.id);
        for (const property of datedProperties) {
          for (const record of records) {
            const date = dateKey(record.values[property.id]);
            if (!date || date < bounds.from || date > bounds.to) continue;
            entries.push({
              recordId: record.id,
              title: record.title,
              databaseId: database.id,
              databaseName: database.name,
              pageId: record.pageId,
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
