"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { todayKey } from "@/lib/calendar";
import { refreshDashboard, useDashboardRequest } from "@/lib/dashboard-request";
import { recordHref } from "@/lib/record-link";
import {
  DEFAULT_TIMELINE_RANGE,
  groupTimelineEntries,
  parseTimelineRange,
  TIMELINE_PAST_DAYS,
  TIMELINE_RANGES,
  timelineDayLabel,
  type TimelineEntry,
  type TimelineRange,
} from "@/lib/timeline";

type TimelineData = {
  today: string;
  range: TimelineRange;
  from: string;
  to: string;
  dateProperties: number;
  entries: TimelineEntry[];
  total: number;
};

function formatDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;

  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * A chronological view over every database's date properties. Nothing has to be
 * configured: a record appears here as soon as it carries a date, so milestones,
 * tasks, and dated notes share one timeline.
 */
export function DashboardTimeline() {
  const [range, setRange] = useState<TimelineRange>(DEFAULT_TIMELINE_RANGE);
  // The horizon is this widget's only contribution to the shared dashboard
  // request; the payload arrives already scoped to it.
  const { data: payload, loading, failed } = useDashboardRequest("timeline", {
    timeline: true,
    timelineDays: String(range),
    today: todayKey(),
  });
  const data = (payload as { timeline: TimelineData | null } | null)?.timeline ?? null;
  const loadError = failed ? "Could not load your timeline." : "";

  const days = groupTimelineEntries(data?.entries ?? []);
  const today = data?.today ?? "";

  return (
    <section
      aria-labelledby="timeline-heading"
      className="rounded-xl border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
            <CalendarDays size={13} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="timeline-heading" className="text-sm font-semibold tracking-tight">
              Timeline
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Dated records across every database, from the last {TIMELINE_PAST_DAYS} days
              onward.
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          Range
          <select
            aria-label="Timeline range"
            value={range}
            onChange={(event) => setRange(parseTimelineRange(event.target.value))}
            className="rounded-md border bg-background px-2 py-1 text-xs text-foreground"
          >
            {TIMELINE_RANGES.map((days) => (
              <option key={days} value={days}>
                Next {days} days
              </option>
            ))}
          </select>
        </label>
      </div>

      {loadError ? (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-3"
        >
          <p className="text-sm text-destructive">{loadError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshDashboard()}
          >
            Try again
          </Button>
        </div>
      ) : loading && !data ? (
        <div
          role="status"
          aria-label="Loading timeline"
          className="mt-4 grid gap-2 sm:grid-cols-2"
        >
          <div className="h-16 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
        </div>
      ) : !data || data.dateProperties === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Add a date property to a database to build a timeline.
        </p>
      ) : days.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          No dated records in the last {TIMELINE_PAST_DAYS} days or the next {range}.
        </p>
      ) : (
        <>
          <ol className="mt-4 space-y-4">
            {days.map((day) => {
              const label = timelineDayLabel(day.date, today);
              return (
                <li key={day.date} className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h3
                      className={`text-[11px] font-semibold uppercase tracking-wide ${
                        label === "Today" ? "text-brand" : "text-muted-foreground"
                      }`}
                    >
                      {label || formatDay(day.date)}
                    </h3>
                    {label && (
                      <span className="text-[11px] text-muted-foreground">
                        {formatDay(day.date)}
                      </span>
                    )}
                  </div>
                  <ul className="mt-1.5 space-y-1 border-l pl-3">
                    {day.entries.map((entry) => (
                      <li
                        key={`${entry.recordId}:${entry.propertyId}`}
                        className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm"
                      >
                        <Link
                          href={recordHref(entry.databaseId, entry.recordId, entry.pageId)}
                          className="min-w-0 truncate font-medium transition-colors hover:text-brand hover:underline"
                        >
                          {entry.title || "Untitled"}
                        </Link>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {entry.databaseName} · {entry.propertyName}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
          {data.total > data.entries.length && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Showing the first {data.entries.length} of {data.total} dated records.
            </p>
          )}
        </>
      )}
    </section>
  );
}
