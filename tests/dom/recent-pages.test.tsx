import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RecentPages } from "../../src/components/recent-pages";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

function seed(entries: { id: string; title: string; visitedAt: number }[]) {
  window.localStorage.setItem("kbs:recent-pages", JSON.stringify(entries));
}

test("RecentPages renders nothing until a page has been visited", () => {
  const { container } = render(<RecentPages />);

  assert.equal(container.innerHTML, "");
});

test("RecentPages links the four most recent pages with visit times", () => {
  const now = Date.now();
  seed([
    { id: "p1", title: "Harvest plan", visitedAt: now },
    { id: "p2", title: "Meeting notes", visitedAt: now - 2 * 60 * 60 * 1000 },
    { id: "p3", title: "Reading list", visitedAt: now - 3 * 24 * 60 * 60 * 1000 },
    { id: "p4", title: "Groceries", visitedAt: now - 5 * 24 * 60 * 60 * 1000 },
    { id: "p5", title: "Older page", visitedAt: now - 9 * 24 * 60 * 60 * 1000 },
  ]);

  render(<RecentPages />);

  const links = screen.getAllByRole("link");
  assert.equal(links.length, 4, "only four recent pages are shown");
  assert.equal(links[0].getAttribute("href"), "/pages/p1");
  assert.match(links[0].textContent ?? "", /Harvest plan/);
  assert.match(links[1].textContent ?? "", /Visited 2h ago/);
  assert.match(links[2].textContent ?? "", /Visited 3d ago/);
  assert.equal(screen.queryByText("Older page"), null);
});

test("RecentPages shows a placeholder for pages with an empty title", () => {
  seed([{ id: "p1", title: "   ", visitedAt: Date.now() }]);

  render(<RecentPages />);

  assert.ok(screen.getByText("Untitled"));
  assert.match(screen.getByRole("link").textContent ?? "", /Visited just now/);
});

test("RecentPages clears the stored history", () => {
  seed([{ id: "p1", title: "Harvest plan", visitedAt: Date.now() }]);
  render(<RecentPages />);

  fireEvent.click(screen.getByRole("button", { name: "Clear" }));

  assert.equal(window.localStorage.getItem("kbs:recent-pages"), null);
  assert.equal(screen.queryByText("Jump back in"), null);
});

test("RecentPages ignores malformed stored entries", () => {
  window.localStorage.setItem(
    "kbs:recent-pages",
    JSON.stringify([{ id: "p1" }, { id: 42, title: "Bad", visitedAt: 1 }, "nope"]),
  );

  const { container } = render(<RecentPages />);

  assert.equal(container.innerHTML, "");
});
