"use client";

import { useState } from "react";
import Link from "next/link";
import { dateKey, todayKey } from "@/lib/calendar";
import {
  parseTimelineRange,
  timelineDayLabel,
  timelineWindow,
  TIMELINE_RANGES,
  type TimelineRange,
} from "@/lib/timeline";
import type { DatabasePropertyType } from "@/lib/database-property";

type TimelineProperty = { id: string; name: string; type: DatabasePropertyType };
type TimelineRecord = { id: string; title: string; values: Record<string, unknown> };

function dayHeading(key: string, today: string): string {
  const formatted = new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const named = timelineDayLabel(key, today);
  return named ? `${named} · ${formatted}` : formatted;
}

/**
 * Places a database's dated records on one chronology. The window keeps a week
 * of recent history before the chosen horizon, matching the home timeline, and
 * records without a date stay visible in their own section.
 */
export function DatabaseTimeline({
  databaseId,
  properties,
  records,
  datePropertyId,
  range,
  onDatePropertyChange,
  onRangeChange,
}: {
  databaseId: string;
  properties: TimelineProperty[];
  records: TimelineRecord[];
  datePropertyId: string;
  range: TimelineRange;
  onDatePropertyChange: (propertyId: string) => void;
  onRangeChange: (range: TimelineRange) => void;
}) {
  const [today] = useState(() => todayKey());

  const dateProperties = properties.filter((property) => property.type === "date");
  const dateProperty =
    dateProperties.find((property) => property.id === datePropertyId) ?? dateProperties[0];

  if (!dateProperty) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        This timeline needs a Date property. Add one, then create a new timeline view.
      </p>
    );
  }

  const window = timelineWindow(today, range);
  const dated = records.flatMap((record) => {
    const key = dateKey(record.values[dateProperty.id]);
    return key ? [{ key, record }] : [];
  });
  const sorted = [...dated].sort(
    (left, right) =>
      left.key.localeCompare(right.key) ||
      left.record.title.localeCompare(right.record.title, undefined, { sensitivity: "base" }),
  );

  const groups = new Map<string, TimelineRecord[]>();
  for (const entry of sorted) {
    if (window && (entry.key < window.from || entry.key > window.to)) continue;
    const existing = groups.get(entry.key) ?? [];
    existing.push(entry.record);
    groups.set(entry.key, existing);
  }
  const days = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  const inWindow = sorted.length - (window
    ? sorted.filter((entry) => entry.key < window.from || entry.key > window.to).length
    : 0);
  const earlier = window ? sorted.filter((entry) => entry.key < window.from).length : 0;
  const later = window ? sorted.filter((entry) => entry.key > window.to).length : 0;
  const undated = records.filter((record) => !dateKey(record.values[dateProperty.id]));

  return (
    <section className="space-y-4" aria-label={`${dateProperty.name} timeline`}>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Dates
          <select
            aria-label="Timeline date property"
            value={dateProperty.id}
            onChange={(event) => onDatePropertyChange(event.target.value)}
            className="rounded-md border bg-background px-2 py-1.5"
          >
            {dateProperties.map((property) => (
              <option key={property.id} value={property.id}>{property.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Horizon
          <select
            aria-label="Timeline range"
            value={range}
            onChange={(event) => onRangeChange(parseTimelineRange(event.target.value))}
            className="rounded-md border bg-background px-2 py-1.5"
          >
            {TIMELINE_RANGES.map((value) => (
              <option key={value} value={value}>Next {value} days</option>
            ))}
          </select>
        </label>
        <span className="text-xs text-muted-foreground">
          {inWindow} {inWindow === 1 ? "record" : "records"} in this window
        </span>
      </div>

      {days.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No records fall inside this window.
        </p>
      ) : (
        <ol className="space-y-4">
          {days.map(([key, dayRecords]) => (
            <li key={key} className="rounded-lg border bg-card">
              <h3 className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {dayHeading(key, today)}
                <span className="ml-2 font-normal normal-case tracking-normal">
                  {dayRecords.length}
                </span>
              </h3>
              <ul className="divide-y">
                {dayRecords.map((record) => (
                  <li key={record.id} className="px-3 py-2 text-sm">
                    <Link
                      href={`/databases/${databaseId}/records/${record.id}`}
                      className="hover:text-primary hover:underline"
                    >
                      {record.title || "Untitled"}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {(earlier > 0 || later > 0) && (
        <p className="text-xs text-muted-foreground">
          {earlier > 0 && `${earlier} earlier ${earlier === 1 ? "record is" : "records are"} outside this window.`}
          {earlier > 0 && later > 0 && " "}
          {later > 0 && `${later} later ${later === 1 ? "record is" : "records are"} beyond the horizon.`}
        </p>
      )}

      <div className="rounded-lg border bg-muted/20 p-3">
        <h3 className="text-sm font-medium">No date</h3>
        {undated.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Every record has a {dateProperty.name} value.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {undated.slice(0, 8).map((record) => (
              <li key={record.id}>
                <Link
                  href={`/databases/${databaseId}/records/${record.id}`}
                  className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 hover:border-primary/30"
                >
                  {record.title || "Untitled"}
                </Link>
              </li>
            ))}
            {undated.length > 8 && (
              <li className="self-center text-muted-foreground">+{undated.length - 8} more</li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
