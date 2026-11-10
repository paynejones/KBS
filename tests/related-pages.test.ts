import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeRelatedSignals,
  rankRelatedPages,
  type RelatedPageCandidate,
} from "../src/lib/related-pages";

function candidate(
  id: string,
  title: string,
  signals: Partial<RelatedPageCandidate["signals"]> = {},
): RelatedPageCandidate {
  return {
    id,
    title,
    signals: { tags: [], pageLinks: [], records: [], ...signals },
  };
}

test("explains every shared signal and weights records over links over tags", () => {
  const described = describeRelatedSignals({
    tags: ["anime", "winter 2026"],
    pageLinks: [{ id: "link-1", title: "Season roadmap" }],
    records: [{ id: "record-1", title: "Episode 1", databaseName: "Anime" }],
  });

  assert.equal(described.score, 2 * 2 + 3 + 4);
  assert.deepEqual(described.reasons, [
    "Both connected to “Episode 1” in Anime",
    "Both link to “Season roadmap”",
    "Shares 2 tags: anime, winter 2026",
  ]);
});

test("ranks the strongest signal first and keeps ties alphabetical", () => {
  const ranked = rankRelatedPages([
    candidate("tag", "Tag neighbour", { tags: ["anime"] }),
    candidate("record", "Record neighbour", {
      records: [{ id: "r", title: "Episode 1", databaseName: "Anime" }],
    }),
    candidate("link-b", "Beta neighbour", {
      pageLinks: [{ id: "p", title: "Shared target" }],
    }),
    candidate("link-a", "Alpha neighbour", {
      pageLinks: [{ id: "p", title: "Shared target" }],
    }),
  ]);

  assert.deepEqual(
    ranked.map((suggestion) => suggestion.id),
    ["record", "link-a", "link-b", "tag"],
  );
});

test("drops pages with nothing in common", () => {
  const ranked = rankRelatedPages([
    candidate("nothing", "Unrelated page"),
    candidate("tag", "Tag neighbour", { tags: ["anime"] }),
  ]);

  assert.deepEqual(ranked.map((suggestion) => suggestion.id), ["tag"]);
});

test("caps the list and summarises long overlaps", () => {
  const ranked = rankRelatedPages(
    [
      candidate("one", "One", { tags: ["a", "b", "c", "d", "e"] }),
      candidate("two", "Two", { tags: ["a"] }),
      candidate("three", "Three", { tags: ["a"] }),
    ],
    2,
  );

  assert.deepEqual(ranked.map((suggestion) => suggestion.id), ["one", "three"]);
  assert.equal(
    ranked[0].reasons[0],
    "Shares 5 tags: a, b, c and 2 more",
  );
});

test("deduplicates tag names before summarising", () => {
  const described = describeRelatedSignals({
    tags: ["anime", "anime", " "],
    pageLinks: [],
    records: [],
  });

  assert.equal(described.score, 2);
  assert.deepEqual(described.reasons, ["Shares 1 tag: anime"]);
});

test("returns a zero score and no reasons without signals", () => {
  assert.deepEqual(describeRelatedSignals({ tags: [], pageLinks: [], records: [] }), {
    score: 0,
    reasons: [],
  });
});
