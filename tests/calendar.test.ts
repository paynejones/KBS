import assert from "node:assert/strict";
import test from "node:test";
import {
  dateKey,
  groupRecordsByDate,
  monthGrid,
  monthLabel,
  shiftMonth,
  todayKey,
} from "../src/lib/calendar";

test("date keys accept stored dates and full timestamps without shifting the day", () => {
  assert.equal(dateKey("2026-11-05"), "2026-11-05");
  assert.equal(dateKey("2026-11-05T23:30:00-05:00"), "2026-11-05");
  assert.equal(dateKey(" 2026-01-09 "), "2026-01-09");
  assert.equal(dateKey(new Date("2026-11-05T12:00:00Z")), "2026-11-05");
  assert.equal(dateKey(""), null);
  assert.equal(dateKey("05/11/2026"), null);
  assert.equal(dateKey("2026-13-01"), null);
  assert.equal(dateKey(undefined), null);
});

test("month grids start on Monday and cover adjacent days", () => {
  const grid = monthGrid(2026, 10);

  assert.equal(grid.length, 42);
  assert.equal(grid[0].key, "2026-10-26", "November 2026 starts on a Sunday, so the grid opens on Monday 26 October");
  assert.equal(grid[0].inMonth, false);
  assert.equal(grid[6].key, "2026-11-01");
  assert.equal(grid[6].inMonth, true);
  assert.equal(grid[34].key, "2026-11-29");
  assert.equal(grid[35].key, "2026-11-30");
  assert.equal(grid[36].key, "2026-12-01");
  assert.equal(grid[36].inMonth, false);
});

test("month labels and navigation are deterministic", () => {
  assert.equal(monthLabel(2026, 10), "November 2026");
  assert.deepEqual(shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
  assert.deepEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  assert.equal(monthLabel(2027, 0), "January 2027");
});

test("records group by their date property and skip undated rows", () => {
  const records = [
    { id: "a", due: "2026-11-05" },
    { id: "b", due: "2026-11-05T18:00:00Z" },
    { id: "c", due: "" },
    { id: "d" },
  ];

  const groups = groupRecordsByDate(records, (record) => record.due);
  assert.deepEqual(groups.get("2026-11-05")?.map((record) => record.id), ["a", "b"]);
  assert.equal(groups.size, 1);
});

test("todayKey uses the local calendar date", () => {
  assert.equal(todayKey(new Date(2026, 10, 5, 23, 30)), "2026-11-05");
  assert.equal(todayKey(new Date(2026, 0, 1, 0, 1)), "2026-01-01");
});

test("month grids handle leap years and months that start on Monday", () => {
  const leap = monthGrid(2028, 1);
  assert.equal(leap[0].key, "2028-01-31", "1 February 2028 is a Tuesday");
  assert.equal(leap.filter((day) => day.inMonth).length, 29);
  assert.ok(leap.some((day) => day.key === "2028-02-29"));

  const mondayStart = monthGrid(2026, 5);
  assert.equal(mondayStart[0].key, "2026-06-01");
  assert.equal(mondayStart[0].inMonth, true);
  assert.equal(mondayStart[41].key, "2026-07-12");
});

test("impossible calendar dates are rejected", () => {
  assert.equal(dateKey("2026-02-31"), null);
  assert.equal(dateKey("2027-02-29"), null);
  assert.equal(dateKey("2028-02-29"), "2028-02-29");
  assert.equal(dateKey("2026-00-10"), null);
});
