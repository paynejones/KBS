import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeReadingUrl,
  readingSourceLabel,
  readingStatusCounts,
} from "../src/lib/reading";

test("a link is optional but must be a usable web address", () => {
  assert.deepEqual(normalizeReadingUrl(""), { ok: true, url: null });
  assert.deepEqual(normalizeReadingUrl("   "), { ok: true, url: null });
  assert.deepEqual(normalizeReadingUrl("  https://example.com/a  "), {
    ok: true,
    url: "https://example.com/a",
  });
  assert.equal(normalizeReadingUrl("javascript:alert(1)").ok, false);
  assert.equal(normalizeReadingUrl("not a link").ok, false);
});

test("the source label keeps the site and falls back to the raw value", () => {
  assert.equal(readingSourceLabel("https://www.example.com/notes?x=1"), "example.com");
  assert.equal(readingSourceLabel(null), "");
  assert.equal(readingSourceLabel("nonsense"), "nonsense");
});

test("status counts cover every status, including empty ones", () => {
  assert.deepEqual(
    readingStatusCounts([{ status: "to-read" }, { status: "finished" }, { status: "finished" }]),
    { "to-read": 1, reading: 0, finished: 2 },
  );
});
