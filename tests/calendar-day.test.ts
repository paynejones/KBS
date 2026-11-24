import assert from "node:assert/strict";
import test from "node:test";
import { msUntilNextCalendarDay } from "../src/lib/calendar-day";

test("the day timer waits until just past the next local midnight", () => {
  assert.equal(
    msUntilNextCalendarDay(new Date(2026, 10, 22, 23, 59, 0)),
    60_250,
    "a minute before midnight waits a minute and a quarter second",
  );
  assert.equal(
    msUntilNextCalendarDay(new Date(2026, 10, 22, 9, 0, 0)),
    15 * 60 * 60 * 1000 + 250,
    "a morning reading waits out the rest of the day",
  );
  assert.equal(
    msUntilNextCalendarDay(new Date(2026, 11, 31, 23, 59, 59)),
    1_250,
    "the timer rolls over year boundaries",
  );
});
