import { dateKey } from "./calendar";

/** A timeline also looks a little way back, so recent milestones stay visible. */
export const TIMELINE_PAST_DAYS = 7;

export const TIMELINE_RANGES = [7, 30, 90] as const;
export type TimelineRange = (typeof TIMELINE_RANGES)[number];
export const DEFAULT_TIMELINE_RANGE: TimelineRange = 30;

/** A single home section should stay scannable even on a busy workspace. */
export const TIMELINE_ENTRY_LIMIT = 40;

/** One record's date property value, ready to place on the timeline. */
export type TimelineEntry = {
  recordId: string;
  title: string;
  databaseId: string;
  databaseName: string;
  propertyId: string;
  propertyName: string;
  date: string;
};

export type TimelineDay = {
  date: string;
  entries: TimelineEntry[];
};

/** Stored or requested ranges are untrusted, so anything else means the default. */
export function parseTimelineRange(value: unknown): TimelineRange {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  return (TIMELINE_RANGES as readonly number[]).includes(numeric)
    ? (numeric as TimelineRange)
    : DEFAULT_TIMELINE_RANGE;
}

/** Moves a `YYYY-MM-DD` key by whole days, crossing months and years. */
export function shiftDateKey(date: string, days: number): string {
  const parsed = dateKey(date);
  if (!parsed || !Number.isFinite(days)) return "";

  const shifted = new Date(`${parsed}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** The inclusive window a timeline shows around today. */
export function timelineWindow(
  today: string,
  range: TimelineRange,
): { from: string; to: string } | null {
  const from = shiftDateKey(today, -TIMELINE_PAST_DAYS);
  const to = shiftDateKey(today, range);
  if (!from || !to) return null;

  return { from, to };
}

/**
 * Chronological order, with a stable tie-break so two records on the same day
 * do not shuffle between loads.
 */
export function sortTimelineEntries(entries: TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) ||
      left.propertyName.localeCompare(right.propertyName, undefined, { sensitivity: "base" }),
  );
}

export function groupTimelineEntries(entries: TimelineEntry[]): TimelineDay[] {
  const days: TimelineDay[] = [];

  for (const entry of sortTimelineEntries(entries)) {
    const day = days[days.length - 1];
    if (day?.date === entry.date) day.entries.push(entry);
    else days.push({ date: entry.date, entries: [entry] });
  }

  return days;
}

/** "Today" and neighbours are worth naming; every other day is just a date. */
export function timelineDayLabel(date: string, today: string): string {
  if (!date || !today) return "";
  if (date === today) return "Today";
  if (date === shiftDateKey(today, 1)) return "Tomorrow";
  if (date === shiftDateKey(today, -1)) return "Yesterday";
  return "";
}
