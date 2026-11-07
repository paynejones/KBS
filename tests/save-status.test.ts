import assert from "node:assert/strict";
import { test } from "node:test";
import { describeSaveState, describeSavedAge } from "../src/lib/save-status";

const now = Date.parse("2026-11-07T12:00:00.000Z");

test("each save state has a distinct label and tone", () => {
  assert.deepEqual(describeSaveState("loading", null, now), { label: "Loading…", tone: "muted" });
  assert.deepEqual(describeSaveState("dirty", null, now), { label: "Unsaved changes", tone: "active" });
  assert.deepEqual(describeSaveState("saving", null, now), { label: "Saving…", tone: "active" });
  assert.deepEqual(describeSaveState("error", null, now), { label: "Save failed", tone: "error" });
});

test("a saved page shows how long ago it was saved", () => {
  assert.deepEqual(describeSaveState("saved", now - 3_000, now), { label: "Saved just now", tone: "success" });
  assert.deepEqual(describeSaveState("saved", now - 5 * 60_000, now), { label: "Saved 5m ago", tone: "success" });
  assert.deepEqual(describeSaveState("saved", null, now), { label: "Saved", tone: "success" });
});

test("saved ages stay coarse and never go negative", () => {
  assert.equal(describeSavedAge(0), "just now");
  assert.equal(describeSavedAge(14_999), "just now");
  assert.equal(describeSavedAge(15_000), "15s ago");
  assert.equal(describeSavedAge(59_999), "59s ago");
  assert.equal(describeSavedAge(60_000), "1m ago");
  assert.equal(describeSavedAge(3_599_999), "59m ago");
  assert.equal(describeSavedAge(3_600_000), "1h ago");
  assert.equal(describeSavedAge(86_399_999), "23h ago");
  assert.equal(describeSavedAge(86_400_000), "earlier");
  assert.equal(describeSavedAge(-5_000), "just now");
  assert.equal(describeSavedAge(Number.NaN), "just now");
});
