import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import { DashboardSavedSearches } from "../../src/components/dashboard-saved-searches";
import { json } from "./fetch-stub";
import { restoreStrictFetch, stubStrictFetch } from "./strict-fetch-stub";

afterEach(() => {
  cleanup();
  restoreStrictFetch();
});

function stubSavedSearches(response: () => Response) {
  return stubStrictFetch("DashboardSavedSearches", (call) =>
    call.url === "/api/saved-searches" && call.method === "GET"
      ? response()
      : undefined,
  );
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

test("with no collections the widget says how to make one", async () => {
  stubSavedSearches(() => json([]));
  render(<DashboardSavedSearches />);

  assert.ok(
    await screen.findByText("Save a search to keep a live collection here."),
  );
  assert.equal(
    screen.getByRole("link", { name: /Open searches/ }).getAttribute("href"),
    "/searches",
  );
  assert.equal(screen.queryByRole("list"), null);
});

test("each widget row opens its own collection", async () => {
  stubSavedSearches(() => json([readingQueue]));
  render(<DashboardSavedSearches />);

  const row = await screen.findByRole("link", { name: /Reading queue/ });
  assert.equal(row.getAttribute("href"), "/searches/search-reading");
  assert.ok(screen.getByText("“design”"));
});

test("a collection deleted elsewhere stops being a widget row", async () => {
  stubSavedSearches(() => json([]));
  render(<DashboardSavedSearches />);

  assert.ok(
    await screen.findByText("Save a search to keep a live collection here."),
  );
  assert.equal(screen.queryByRole("link", { name: /Reading queue/ }), null);
});
