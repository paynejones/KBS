import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TIMELINE_RANGE,
  groupTimelineEntries,
  parseTimelineRange,
  shiftDateKey,
  sortTimelineEntries,
  TIMELINE_PAST_DAYS,
  timelineDayLabel,
  timelineWindow,
  type TimelineEntry,
} from "../src/lib/timeline";

function entry(overrides: Partial<TimelineEntry>): TimelineEntry {
  return {
    recordId: "record-1",
    title: "Record",
    databaseId: "database-1",
    databaseName: "Tasks",
    propertyId: "property-1",
    propertyName: "Due",
    date: "2026-05-10",
    ...overrides,
  };
}

test("timeline ranges accept only the offered horizons", () => {
  assert.equal(DEFAULT_TIMELINE_RANGE, 30);
  assert.equal(parseTimelineRange(7), 7);
  assert.equal(parseTimelineRange("30"), 30);
  assert.equal(parseTimelineRange(90), 90);
  assert.equal(parseTimelineRange(" 7 "), 7);

  for (const value of [null, undefined, "", "abc", 0, 15, -30, 365]) {
    assert.equal(parseTimelineRange(value), 30, String(value));
  }
});

test("date keys shift across month and year boundaries", () => {
  assert.equal(shiftDateKey("2026-05-10", -7), "2026-05-03");
  assert.equal(shiftDateKey("2026-05-10", 30), "2026-06-09");
  assert.equal(shiftDateKey("2026-01-02", -7), "2025-12-26");
  assert.equal(shiftDateKey("2024-02-28", 1), "2024-02-29");
  assert.equal(shiftDateKey("not-a-date", 1), "");
  assert.equal(shiftDateKey("2026-02-31", 1), "", "impossible dates have no key");
});

test("the timeline window keeps a week of history before the chosen horizon", () => {
  assert.equal(TIMELINE_PAST_DAYS, 7);
  assert.deepEqual(timelineWindow("2026-05-10", 30), {
    from: "2026-05-03",
    to: "2026-06-09",
  });
  assert.deepEqual(timelineWindow("2026-05-10", 7), {
    from: "2026-05-03",
    to: "2026-05-17",
  });
  assert.equal(timelineWindow("nope", 30), null);
});

test("timeline entries sort by date, then title and property", () => {
  const sorted = sortTimelineEntries([
    entry({ recordId: "c", title: "Zebra", date: "2026-05-12" }),
    entry({ recordId: "a", title: "Harvest", date: "2026-05-10" }),
    entry({ recordId: "b", title: "Harvest", date: "2026-05-12", propertyId: "property-2", propertyName: "Release" }),
    entry({ recordId: "d", title: "Anchor", date: "2026-05-12" }),
    entry({ recordId: "e", title: "Harvest", date: "2026-05-12", propertyId: "property-3", propertyName: "Review" }),
  ]);

  assert.deepEqual(
    sorted.map((row) => row.recordId),
    ["a", "d", "b", "e", "c"],
    "same-day entries fall back to title, then property name",
  );
});

test("entries group into one bucket per date in chronological order", () => {
  const days = groupTimelineEntries([
    entry({ recordId: "later", date: "2026-05-12" }),
    entry({ recordId: "first", date: "2026-05-10" }),
    entry({ recordId: "second", date: "2026-05-10", title: "Another" }),
  ]);

  assert.deepEqual(days.map((day) => day.date), ["2026-05-10", "2026-05-12"]);
  assert.deepEqual(
    days[0].entries.map((row) => row.recordId),
    ["second", "first"],
    "grouped entries keep the sorted order",
  );
  assert.deepEqual(groupTimelineEntries([]), []);
});

test("nearby days get names and the rest stay dates", () => {
  assert.equal(timelineDayLabel("2026-05-10", "2026-05-10"), "Today");
  assert.equal(timelineDayLabel("2026-05-11", "2026-05-10"), "Tomorrow");
  assert.equal(timelineDayLabel("2026-05-09", "2026-05-10"), "Yesterday");
  assert.equal(timelineDayLabel("2026-05-15", "2026-05-10"), "");
  assert.equal(timelineDayLabel("", "2026-05-10"), "");
  assert.equal(timelineDayLabel("2026-05-10", ""), "");
});
