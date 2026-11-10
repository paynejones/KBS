import assert from "node:assert/strict";
import test from "node:test";
import {
  isReadingKind,
  isReadingStatus,
  normalizeReadingUrl,
  readingSourceLabel,
  readingStatusCounts,
} from "../src/lib/reading";

test("kind and status guards accept only known values", () => {
  assert.equal(isReadingKind("book"), true);
  assert.equal(isReadingKind("article"), true);
  assert.equal(isReadingKind("film"), false);
  assert.equal(isReadingKind(3), false);

  assert.equal(isReadingStatus("to-read"), true);
  assert.equal(isReadingStatus("finished"), true);
  assert.equal(isReadingStatus("paused"), false);
});

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
