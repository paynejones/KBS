import assert from "node:assert/strict";
import test from "node:test";
import {
  addRecentPage,
  formatRecentTime,
  parseRecentPages,
  RECENT_PAGES_LIMIT,
  type RecentPage,
} from "../src/lib/recents";

test("recent pages parsing keeps valid rows and drops malformed or duplicate entries", () => {
  const now = Date.now();
  const parsed = parseRecentPages(
    JSON.stringify([
      { id: "a", title: "Alpha", visitedAt: now },
      { id: "a", title: "Alpha again", visitedAt: now - 1 },
      { id: "b", title: "Beta", visitedAt: now - 5 },
      { id: "", title: "No id", visitedAt: now },
      { id: "c", title: "Bad time", visitedAt: "yesterday" },
      { id: "d", title: 42, visitedAt: now },
      "nope",
      null,
    ]),
  );

  assert.deepEqual(parsed, [
    { id: "a", title: "Alpha", visitedAt: now },
    { id: "b", title: "Beta", visitedAt: now - 5 },
  ]);
});

test("recent pages parsing tolerates empty and non-array storage", () => {
  assert.deepEqual(parseRecentPages(null), []);
  assert.deepEqual(parseRecentPages("not json"), []);
  assert.deepEqual(parseRecentPages(JSON.stringify({ id: "a" })), []);
});

test("recent pages parsing caps stale history at the limit", () => {
  const serialized = JSON.stringify(
    Array.from({ length: RECENT_PAGES_LIMIT + 5 }, (_, index) => ({
      id: `page-${index}`,
      title: `Page ${index}`,
      visitedAt: 1_000 + index,
    })),
  );

  assert.equal(parseRecentPages(serialized).length, RECENT_PAGES_LIMIT);
});

test("recent pages move revisits to the front, rename, and stay capped", () => {
  let recent: RecentPage[] = [];
  for (let index = 0; index < RECENT_PAGES_LIMIT + 3; index += 1) {
    recent = addRecentPage(recent, { id: `page-${index}`, title: `Page ${index}` }, 1_000 + index);
  }

  assert.equal(recent.length, RECENT_PAGES_LIMIT);
  assert.equal(recent[0].id, `page-${RECENT_PAGES_LIMIT + 2}`);

  const revisited = addRecentPage(
    recent,
    { id: `page-${RECENT_PAGES_LIMIT + 1}`, title: "Renamed" },
    9_999,
  );

  assert.equal(revisited[0].id, `page-${RECENT_PAGES_LIMIT + 1}`);
  assert.equal(revisited[0].title, "Renamed");
  assert.equal(
    revisited.filter((entry) => entry.id === `page-${RECENT_PAGES_LIMIT + 1}`).length,
    1,
  );
});

test("recent pages fall back to a placeholder title and ignore missing ids", () => {
  const recent = addRecentPage([], { id: "a", title: "   " }, 1_000);
  assert.equal(recent[0].title, "Untitled");
  assert.deepEqual(addRecentPage(recent, { id: "", title: "Nope" }, 2_000), recent);
});

test("recent timestamps describe the age of a visit", () => {
  const now = 1_700_000_000_000;
  assert.equal(formatRecentTime(now - 5_000, now), "just now");
  assert.equal(formatRecentTime(now - 5 * 60_000, now), "5m ago");
  assert.equal(formatRecentTime(now - 3 * 3_600_000, now), "3h ago");
  assert.equal(formatRecentTime(now - 2 * 86_400_000, now), "2d ago");
});
