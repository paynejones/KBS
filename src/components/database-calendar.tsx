"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  dateKey,
  groupRecordsByDate,
  monthGrid,
  monthLabel,
  shiftMonth,
  todayKey,
  WEEKDAY_LABELS,
} from "@/lib/calendar";

type CalendarProperty = { id: string; name: string; type: string };
type CalendarRecord = {
  id: string;
  title: string;
  values: Record<string, unknown>;
  pageId: string | null;
};

export function DatabaseCalendar({
  databaseId,
  properties,
  records,
  datePropertyId,
  onDatePropertyChange,
}: {
  databaseId: string;
  properties: CalendarProperty[];
  records: CalendarRecord[];
  datePropertyId: string;
  onDatePropertyChange: (propertyId: string) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [today] = useState(() => todayKey());

  const dateProperties = properties.filter((property) => property.type === "date");
  const dateProperty = dateProperties.find((property) => property.id === datePropertyId) ?? dateProperties[0];

  if (!dateProperty) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        This calendar needs a Date property. Add one, then create a new calendar view.
      </p>
    );
  }

  const groups = groupRecordsByDate(records, (record) => record.values[dateProperty.id]);
  const days = monthGrid(cursor.year, cursor.month);
  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`;
  const scheduledThisMonth = [...groups.entries()]
    .filter(([key]) => key.startsWith(monthPrefix))
    .reduce((total, [, entries]) => total + entries.length, 0);
  const undated = records.filter((record) => !dateKey(record.values[dateProperty.id]));

  function moveMonth(delta: number) {
    setCursor((current) => shiftMonth(current.year, current.month, delta));
  }

  return (
    <section className="space-y-4" aria-label={`${dateProperty.name} calendar`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="icon" onClick={() => moveMonth(-1)} aria-label="Previous month">
          <ChevronLeft size={16} />
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={() => moveMonth(1)} aria-label="Next month">
          <ChevronRight size={16} />
        </Button>
        <h2 className="min-w-44 text-lg font-semibold tracking-tight" aria-live="polite">
          {monthLabel(cursor.year, cursor.month)}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const current = new Date();
            setCursor({ year: current.getFullYear(), month: current.getMonth() });
          }}
        >
          Today
        </Button>
        <label className="flex items-center gap-2 text-sm">
          Dates
          <select
            aria-label="Calendar date property"
            value={dateProperty.id}
            onChange={(event) => onDatePropertyChange(event.target.value)}
            className="rounded-md border bg-background px-2 py-1.5"
          >
            {dateProperties.map((property) => (
              <option key={property.id} value={property.id}>{property.name}</option>
            ))}
          </select>
        </label>
        <span className="text-xs text-muted-foreground">
          {scheduledThisMonth} {scheduledThisMonth === 1 ? "record" : "records"} this month
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-7 gap-1 pb-1 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const dayRecords = groups.get(day.key) ?? [];
              const isToday = day.key === today;

              return (
                <div
                  key={day.key}
                  className={`min-h-24 rounded-lg border p-1.5 text-xs ${
                    day.inMonth ? "bg-card" : "bg-muted/20 text-muted-foreground"
                  } ${isToday ? "border-primary/60 ring-1 ring-primary/30" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={isToday ? "font-semibold text-primary" : "font-medium"}>{day.day}</span>
                    {isToday && <span className="text-[10px] uppercase tracking-wide text-primary">Today</span>}
                  </div>
                  <ul className="mt-1 space-y-1">
                    {dayRecords.slice(0, 3).map((record) => (
                      <li key={record.id} className="truncate" title={record.title || "Untitled"}>
                        <Link href={`/databases/${databaseId}/records/${record.id}`} className="block truncate rounded bg-primary/10 px-1 py-0.5 text-primary hover:underline">
                          {record.title || "Untitled"}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {dayRecords.length > 3 && (
                    <p className="mt-1 text-muted-foreground">+{dayRecords.length - 3} more</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20 p-3">
        <h3 className="text-sm font-medium">No date</h3>
        {undated.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">Every record has a {dateProperty.name} value.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {undated.slice(0, 8).map((record) => (
              <li key={record.id}>
                <Link href={`/databases/${databaseId}/records/${record.id}`} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 hover:border-primary/30">
                  {record.title || "Untitled"} <ArrowRight size={12} />
                </Link>
              </li>
            ))}
            {undated.length > 8 && <li className="self-center text-muted-foreground">+{undated.length - 8} more</li>}
          </ul>
        )}
      </div>
    </section>
  );
}
