import { dateKey } from "./calendar";
import { shiftDateKey, timelineWindow, type TimelineRange } from "./timeline";

export type ChartProperty = {
  id: string;
  name: string;
  type: string;
  options?: { choices?: string[] };
};

export type ChartRecord = {
  id: string;
  title: string;
  values: Record<string, unknown>;
};

export type ChartDatum = {
  label: string;
  value: number;
  /** How many records stand behind the bar; grouping merges several. */
  count: number;
  /** The record a single bar came from, or null for a grouped bar. */
  recordId: string | null;
  /** Dated records in this group outside the active date window. */
  outside?: number;
};

export type ChartOutsideOnlyGroup = {
  label: string;
  count: number;
};

export type ChartData = {
  data: ChartDatum[];
  /** The largest absolute value, used to scale every bar the same way. */
  max: number;
  total: number;
  /** Records whose value was blank or not a number. */
  skipped: number;
  /** Records left out by the bar limit. */
  hidden: number;
  /** Groups whose records all fall outside the active window, so they have no bar or slice. */
  outsideOnlyGroups: ChartOutsideOnlyGroup[];
};

export type ChartPoint = {
  label: string;
  value: number;
  recordId: string;
  /** The date this point sits at when the series has a date axis. */
  date?: string;
};

export type ChartSeries = {
  points: ChartPoint[];
  /** Bounds always include zero, so the line keeps a truthful baseline. */
  min: number;
  max: number;
  skipped: number;
  hidden: number;
  /** Records with a date inside the window, chartable value or not. */
  inWindow: number;
  /** The first and last dates drawn by a date-axis series. */
  from?: string;
  to?: string;
  /** Records with a value but no usable date on a date-axis series. */
  undated?: number;
  /** Records whose date falls outside the rolling window. */
  outside?: number;
};

export type PieSlice = {
  label: string;
  value: number;
  /** Share of the positive total, 0–100. */
  percent: number;
  /** Records in this slice whose dates fall outside the active window. */
  outside: number;
  recordId: string | null;
};

export type PieData = {
  slices: PieSlice[];
  total: number;
  /** Bars left out because a pie slice cannot be zero or negative. */
  excluded: number;
};

export const CHART_BAR_LIMIT = 12;

export const CHART_TYPES = ["bars", "pie", "line"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** Saved chart types are untrusted JSON, so anything unknown means bars. */
export function parseChartType(value: unknown): ChartType {
  return value === "pie" || value === "line" ? value : "bars";
}

/** Ten years of history is plenty, and a future window would repeat today's. */
export const CHART_DATE_OFFSET_LIMIT = 3650;

/**
 * A saved window shift is untrusted: whole days only, never later than today.
 * Negative values review earlier periods; zero keeps the window ending today.
 */
export function parseChartDateOffset(value: unknown): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : 0;
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-CHART_DATE_OFFSET_LIMIT, Math.min(0, Math.trunc(numeric)));
}

export const CHART_DATE_PRESETS = ["this-month", "last-month"] as const;
export type ChartDatePreset = (typeof CHART_DATE_PRESETS)[number];

/** Unknown saved presets fall back to the rolling window. */
export function parseChartDatePreset(value: unknown): ChartDatePreset | null {
  return value === "this-month" || value === "last-month" ? value : null;
}

/** A saved explicit bound as `YYYY-MM-DD`, or null when it is not a real date. */
export function parseChartDateBound(value: unknown): string | null {
  return dateKey(value);
}

/**
 * Opens a database with a temporary filter for one bar or pie slice. A
 * single-record datum filters by record id; grouped data filters by the group
 * property's label, matching how chartData buckets records.
 */
export function chartDatumRecordsHref(
  databaseId: string,
  options: {
    recordId?: string | null;
    groupPropertyId?: string | null;
    groupLabel?: string;
    /** An optional date window to keep alongside the slice filter. */
    rangePropertyId?: string | null;
    rangeStart?: string;
    rangeEnd?: string;
    viewId?: string;
    fromViewId?: string;
    /** Mark links opened from a pinned dashboard widget. */
    fromDashboard?: boolean;
  },
): string {
  const params = new URLSearchParams();
  if (options.recordId) {
    params.set("record", options.recordId);
  } else if (options.groupPropertyId) {
    params.set("filterProperty", options.groupPropertyId);
    params.set("filterValue", options.groupLabel ?? "");
  }
  if (options.rangePropertyId && options.rangeStart && options.rangeEnd) {
    params.set("rangeProperty", options.rangePropertyId);
    params.set("rangeStart", options.rangeStart);
    params.set("rangeEnd", options.rangeEnd);
  }
  if (options.viewId) params.set("view", options.viewId);
  if (options.fromViewId) params.set("from", options.fromViewId);
  if (options.fromDashboard) params.set("origin", "dashboard");
  return `/databases/${encodeURIComponent(databaseId)}?${params.toString()}`;
}

/**
 * Opens a database with its records temporarily filtered to a chart's window.
 * The chosen view, when given, shows those records instead of the chart.
 */
export function chartRangeRecordsHref(
  databaseId: string,
  datePropertyId: string,
  from: string,
  to: string,
  viewId?: string,
  fromViewId?: string,
  fromDashboard?: boolean,
): string {
  const params = new URLSearchParams({
    rangeProperty: datePropertyId,
    rangeStart: from,
    rangeEnd: to,
  });
  if (viewId) params.set("view", viewId);
  if (fromViewId) params.set("from", fromViewId);
  if (fromDashboard) params.set("origin", "dashboard");
  return `/databases/${encodeURIComponent(databaseId)}?${params.toString()}`;
}

/** Opens the database with one group's records that fall outside a chart's window. */
export function chartOutsideGroupRecordsHref(
  databaseId: string,
  datePropertyId: string,
  from: string,
  to: string,
  groupPropertyId: string,
  groupLabel: string,
  viewId?: string,
  fromViewId?: string,
  fromDashboard?: boolean,
): string {
  return `${chartDatumRecordsHref(databaseId, {
    groupPropertyId,
    groupLabel,
    rangePropertyId: datePropertyId,
    rangeStart: from,
    rangeEnd: to,
    viewId,
    fromViewId,
    fromDashboard,
  })}&rangeMode=outside`;
}

/** Opens the database with the dated records outside a chart's window. */
export function chartOutsideRecordsHref(
  databaseId: string,
  datePropertyId: string,
  from: string,
  to: string,
  viewId?: string,
  fromViewId?: string,
  fromDashboard?: boolean,
): string {
  return `${chartRangeRecordsHref(
    databaseId,
    datePropertyId,
    from,
    to,
    viewId,
    fromViewId,
    fromDashboard,
  )}&rangeMode=outside`;
}

/**
 * An explicit From/To range in calendar order. Both ends are needed; a
 * half-filled range keeps the rolling window instead.
 */
export function chartDateRangeWindow(
  start: unknown,
  end: unknown,
): { from: string; to: string } | null {
  const from = parseChartDateBound(start);
  const to = parseChartDateBound(end);
  if (!from || !to) return null;
  return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * The window drawn by a date-axis line. An explicit From/To range wins over
 * the rolling window; otherwise the window is shifted back by whole days so
 * past periods can be reviewed, with the past week kept before the horizon.
 */
export function chartDateWindow(
  today: string,
  range: TimelineRange,
  offsetDays: number,
  start?: unknown,
  end?: unknown,
  preset?: unknown,
): { from: string; to: string } | null {
  const presetWindow = chartDatePresetWindow(today, preset);
  if (presetWindow) return presetWindow;
  const custom = chartDateRangeWindow(start, end);
  if (custom) return custom;
  const anchor = shiftDateKey(today, parseChartDateOffset(offsetDays));
  return anchor ? timelineWindow(anchor, range) : null;
}

/**
 * The first and last day of the current or a prior month, used by the This
 * month and Last month shortcuts. The shortcut fills an explicit range, which
 * is then saved like hand-picked dates.
 */
export function chartMonthRange(
  today: unknown,
  monthsBack = 0,
): { from: string; to: string } | null {
  const key = dateKey(today);
  if (!key) return null;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const first = new Date(Date.UTC(2000, month - 1 - monthsBack, 1));
  // Date.UTC maps years 0–99 to 1900–1999, so move the year afterwards.
  first.setUTCFullYear(first.getUTCFullYear() + year - 2000);
  const last = new Date(first.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/**
 * The window for a saved month preset, recomputed from today every time so it
 * follows the calendar instead of freezing the dates that were picked.
 */
export function chartDatePresetWindow(
  today: unknown,
  preset: unknown,
): { from: string; to: string } | null {
  const parsed = parseChartDatePreset(preset);
  if (!parsed) return null;
  return chartMonthRange(today, parsed === "last-month" ? 1 : 0);
}

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function dateParts(key: string): [number, number, number] {
  return [
    Number(key.slice(0, 4)),
    Number(key.slice(5, 7)),
    Number(key.slice(8, 10)),
  ];
}

/** A compact, locale-independent title for a date span: `Nov 1–30, 2026`. */
export function chartDateSpanLabel(from: unknown, to: unknown): string {
  const startKey = parseChartDateBound(from);
  const endKey = parseChartDateBound(to);
  if (!startKey || !endKey) return "";
  if (startKey > endKey) return chartDateSpanLabel(endKey, startKey);

  const [startYear, startMonth, startDay] = dateParts(startKey);
  const [endYear, endMonth, endDay] = dateParts(endKey);
  const startLabel = `${SHORT_MONTHS[startMonth - 1] ?? ""} ${startDay}`;
  const endLabel = `${SHORT_MONTHS[endMonth - 1] ?? ""} ${endDay}`;
  if (startYear === endYear && startMonth === endMonth) {
    return `${startLabel}–${endDay}, ${startYear}`;
  }
  if (startYear === endYear) return `${startLabel} – ${endLabel}, ${startYear}`;
  return `${startLabel}, ${startYear} – ${endLabel}, ${endYear}`;
}

/** A line stays readable for a couple of dozen points; the rest are counted. */
export const CHART_LINE_LIMIT = 24;

/** A stored value as a finite number, or null when it cannot be charted. */
export function numericChartValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Builds the bars for a numeric property. Without a grouping property each
 * record is one bar, largest first, so outliers and empty values are obvious.
 * With one, records are summed per choice so a comparison across statuses,
 * categories, or owners stays readable. Calculated values are read through
 * `valueFor`, matching the table's rollups and formulas.
 */
export function chartData<T extends ChartRecord>(
  records: readonly T[],
  property: ChartProperty,
  options?: {
    valueFor?: (record: T, property: ChartProperty) => unknown;
    groupBy?: ChartProperty | null;
    /** Count records outside the window per group without charting them. */
    dateProperty?: ChartProperty | null;
    dateWindow?: { from: string; to: string } | null;
    limit?: number;
  },
): ChartData {
  const valueFor =
    options?.valueFor ?? ((record: T, target: ChartProperty) => record.values[target.id]);
  const limit = Math.max(1, options?.limit ?? CHART_BAR_LIMIT);
  const groupBy = options?.groupBy ?? null;
  const dateProperty = options?.dateProperty ?? null;
  const dateWindow = options?.dateWindow ?? null;

  let total = 0;
  let skipped = 0;

  if (groupBy) {
    const buckets = new Map<string, { value: number; count: number }>();
    const outsideByGroup = new Map<string, number>();
    const groupTotals = new Map<string, number>();

    for (const record of records) {
      const key = String(record.values[groupBy.id] ?? "").trim() || "No value";
      groupTotals.set(key, (groupTotals.get(key) ?? 0) + 1);
      if (dateProperty && dateWindow) {
        const date = dateKey(record.values[dateProperty.id]);
        if (date === null) continue;
        if (date < dateWindow.from || date > dateWindow.to) {
          outsideByGroup.set(key, (outsideByGroup.get(key) ?? 0) + 1);
          continue;
        }
      }
      const value = numericChartValue(valueFor(record, property));
      if (value === null) {
        skipped += 1;
        continue;
      }
      const bucket = buckets.get(key) ?? { value: 0, count: 0 };
      bucket.value += value;
      bucket.count += 1;
      buckets.set(key, bucket);
      total += value;
    }

    // Saved choices keep their configured order before any value that is no
    // longer a choice; the bars themselves still sort largest first.
    const choices = groupBy.options?.choices ?? [];
    const labels = [
      ...new Set([
        ...choices.filter((choice) => buckets.has(choice)),
        ...buckets.keys(),
      ]),
    ];

    const sorted = labels
      .map((label) => {
        const bucket = buckets.get(label)!;
        return {
          label,
          value: bucket.value,
          count: bucket.count,
          recordId: null,
          outside: outsideByGroup.get(label) ?? 0,
        };
      })
      .sort(
        (left, right) =>
          right.value - left.value ||
          left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
      );

    const outsideOnlyGroups = [...outsideByGroup.entries()]
      .filter(([label, count]) => groupTotals.get(label) === count)
      .map(([label, count]) => ({ label, count }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
      );

    const shown = sorted.slice(0, limit);
    return {
      data: shown,
      max: Math.max(0, ...shown.map((datum) => Math.abs(datum.value))),
      total,
      skipped,
      hidden: sorted.slice(limit).reduce((sum, datum) => sum + datum.count, 0),
      outsideOnlyGroups,
    };
  }

  const bars: ChartDatum[] = [];
  for (const record of records) {
    if (dateProperty && dateWindow) {
      const date = dateKey(record.values[dateProperty.id]);
      if (date === null || date < dateWindow.from || date > dateWindow.to) continue;
    }
    const value = numericChartValue(valueFor(record, property));
    if (value === null) {
      skipped += 1;
      continue;
    }
    total += value;
    bars.push({
      label: record.title?.trim() || "Untitled",
      value,
      count: 1,
      recordId: record.id,
    });
  }

  bars.sort(
    (left, right) =>
      right.value - left.value ||
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) ||
      (left.recordId ?? "").localeCompare(right.recordId ?? ""),
  );

  const shown = bars.slice(0, limit);
  return {
    data: shown,
    max: Math.max(0, ...shown.map((datum) => Math.abs(datum.value))),
    total,
    skipped,
    hidden: bars.length - shown.length,
    outsideOnlyGroups: [],
  };
}

/**
 * Values in the order the view already shows its records, so changing the saved
 * sorts changes the line. With a date property the points become a time series:
 * they sort chronologically and undated records are counted instead of placed.
 * Grouping does not apply: each point is one record.
 */
export function chartSeries<T extends ChartRecord>(
  records: readonly T[],
  property: ChartProperty,
  options?: {
    valueFor?: (record: T, property: ChartProperty) => unknown;
    dateProperty?: ChartProperty | null;
    /** Inclusive day bounds; points outside them are counted instead. */
    dateWindow?: { from: string; to: string } | null;
    limit?: number;
  },
): ChartSeries {
  const valueFor =
    options?.valueFor ?? ((record: T, target: ChartProperty) => record.values[target.id]);
  const dateProperty = options?.dateProperty ?? null;
  const dateWindow = options?.dateWindow ?? null;
  const limit = Math.max(1, options?.limit ?? CHART_LINE_LIMIT);
  const points: ChartPoint[] = [];
  let skipped = 0;
  let undated = 0;
  let outside = 0;
  let inWindow = 0;

  for (const record of records) {
    const value = numericChartValue(valueFor(record, property));
    const date = dateProperty ? dateKey(record.values[dateProperty.id]) : null;
    if (dateProperty && date) {
      if (!dateWindow || (date >= dateWindow.from && date <= dateWindow.to)) {
        inWindow += 1;
      } else {
        outside += 1;
      }
    }
    if (value === null) {
      skipped += 1;
      continue;
    }
    if (dateProperty) {
      if (!date) {
        undated += 1;
        continue;
      }
      if (dateWindow && (date < dateWindow.from || date > dateWindow.to)) {
        continue;
      }
      points.push({
        label: record.title?.trim() || "Untitled",
        value,
        recordId: record.id,
        date,
      });
      continue;
    }
    points.push({
      label: record.title?.trim() || "Untitled",
      value,
      recordId: record.id,
    });
  }

  if (dateProperty) {
    points.sort(
      (left, right) =>
        (left.date ?? "").localeCompare(right.date ?? "") ||
        left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) ||
        left.recordId.localeCompare(right.recordId),
    );
  }

  const shown = points.slice(0, limit);
  return {
    points: shown,
    min: Math.min(0, ...shown.map((point) => point.value)),
    max: Math.max(0, ...shown.map((point) => point.value)),
    skipped,
    hidden: points.length - shown.length,
    inWindow,
    ...(dateProperty
      ? {
          from: shown[0]?.date,
          to: shown[shown.length - 1]?.date,
          undated,
          outside,
        }
      : {}),
  };
}

/** A pie shows share of total, so only positive values become slices. */
export function pieData(data: readonly ChartDatum[]): PieData {
  const positive = data.filter((datum) => datum.value > 0);
  const total = positive.reduce((sum, datum) => sum + datum.value, 0);

  return {
    slices: total > 0
      ? positive.map((datum) => ({
          label: datum.label,
          value: datum.value,
          percent: (datum.value / total) * 100,
          outside: datum.outside ?? 0,
          recordId: datum.recordId,
        }))
      : [],
    total,
    excluded: data.length - positive.length,
  };
}
