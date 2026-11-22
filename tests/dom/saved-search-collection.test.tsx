import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import { SavedSearchCollection } from "../../src/components/saved-search-collection";
import { json } from "./fetch-stub";
import { restoreStrictFetch, stubStrictFetch } from "./strict-fetch-stub";

afterEach(() => {
  cleanup();
  restoreStrictFetch();
});

function stubCollection(
  searches: () => Response,
  pages?: () => Response,
) {
  return stubStrictFetch("SavedSearchCollection", (call) => {
    if (call.url === "/api/saved-searches" && call.method === "GET") {
      return searches();
    }
    if (call.url.startsWith("/api/pages?") && call.method === "GET") {
      return pages?.();
    }
    return undefined;
  });
}

const readingQueue = {
  id: "search-reading",
  name: "Reading queue",
  query: "design",
  tagId: null,
  tagName: null,
  favoritesOnly: false,
  createdAt: "2026-04-01T10:00:00.000Z",
};

test("a deleted collection explains itself instead of loading forever", async () => {
  stubCollection(() =>
    json([
      {
        id: "search-other",
        name: "Inbox zero",
        query: "",
        tagId: null,
        tagName: null,
        favoritesOnly: true,
        createdAt: "2026-04-02T10:00:00.000Z",
      },
    ]),
  );

  render(<SavedSearchCollection id="search-deleted" />);

  assert.ok(
    await screen.findByRole("heading", {
      name: "This collection is no longer available",
    }),
  );
  assert.equal(
    screen.getByRole("link", { name: /Back to saved searches/ }).getAttribute("href"),
    "/searches",
  );
});

test("a collection runs its filters again on every visit", async () => {
  const calls = stubCollection(
    () => json([readingQueue]),
    () =>
      json({
        total: 9,
        pages: [{ id: "page-1", title: "Design systems" }],
      }),
  );

  render(<SavedSearchCollection id={readingQueue.id} />);

  assert.ok(await screen.findByRole("heading", { name: "Reading queue" }));
  assert.ok(await screen.findByText("9 pages match right now"));
  assert.equal(screen.getByText("“design”").textContent, "“design”");
  assert.equal(
    screen.getByRole("link", { name: /Design systems/ }).getAttribute("href"),
    "/pages/page-1",
  );
  assert.equal(
    screen.getByRole("link", { name: /\+8 more pages/ }).getAttribute("href"),
    "/pages?q=design",
  );
  assert.ok(
    calls.some(
      (call) =>
        call.url.startsWith("/api/pages?") &&
        call.url.includes("q=design") &&
        call.url.includes("limit=6"),
    ),
    "the collection asks for the same preview window the searches screen uses",
  );
});

test("a favorites collection sends its all-matches link to favorites", async () => {
  stubCollection(
    () =>
      json([
        {
          ...readingQueue,
          favoritesOnly: true,
          query: "",
        },
      ]),
    () => json({ total: 3, pages: [] }),
  );

  render(<SavedSearchCollection id={readingQueue.id} />);

  assert.ok(await screen.findByText("No pages match this collection right now."));
  assert.equal(
    screen.getByRole("link", { name: /\+3 more pages/ }).getAttribute("href"),
    "/favorites",
  );
});
