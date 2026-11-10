import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DashboardTimeline } from "../../src/components/dashboard-timeline";
import { json } from "./fetch-stub";
import { restoreStrictFetch, stubStrictFetch } from "./strict-fetch-stub";

afterEach(() => {
  cleanup();
  restoreStrictFetch();
});

function stubTimeline(response: () => Response) {
  return stubStrictFetch("DashboardTimeline", (call) =>
    call.url.split("?")[0] === "/api/dashboard" && call.method === "GET"
      ? response()
      : undefined,
  );
}

const entries = [
  {
    recordId: "record-1",
    title: "Ship the beta",
    databaseId: "db-tasks",
    databaseName: "Tasks",
    propertyId: "property-due",
    propertyName: "Due",
    date: "2026-05-10",
  },
  {
    recordId: "record-2",
    title: "Chapter 12",
    databaseId: "db-reading",
    databaseName: "Reading",
    propertyId: "property-finished",
    propertyName: "Finished",
    date: "2026-05-11",
  },
];

const timeline = {
  today: "2026-05-10",
  range: 30,
  from: "2026-05-03",
  to: "2026-06-09",
  dateProperties: 2,
  entries,
  total: 60,
};

test("shows dated records across databases grouped by day", async () => {
  const calls = stubTimeline(() => json({ timeline }));
  render(<DashboardTimeline />);

  assert.ok(screen.getByRole("heading", { name: "Timeline" }));
  assert.ok(await screen.findByRole("link", { name: "Ship the beta" }));
  assert.ok(screen.getByRole("heading", { name: "Today" }));
  assert.ok(screen.getByRole("heading", { name: "Tomorrow" }));
  assert.ok(screen.getByText("Tasks · Due"));
  assert.ok(screen.getByText("Reading · Finished"));
  assert.ok(
    screen.getByText("Showing the first 2 of 60 dated records."),
    "a capped timeline says how many were left out",
  );

  const link = screen.getByRole("link", { name: "Ship the beta" });
  assert.equal(link.getAttribute("href"), "/databases/db-tasks/records/record-1");

  const call = calls.find((request) => request.url.includes("timeline=1"));
  assert.ok(call);
  assert.match(call.url, /timelineDays=30/);
});

test("changing the range asks for the new horizon", async () => {
  const calls = stubTimeline(() => json({ timeline }));
  render(<DashboardTimeline />);

  await screen.findByRole("link", { name: "Ship the beta" });
  fireEvent.change(screen.getByLabelText("Timeline range"), {
    target: { value: "7" },
  });

  await waitFor(() =>
    assert.ok(
      calls.some((call) => call.url.includes("timelineDays=7")),
      "the new range is requested",
    ),
  );
});

test("explains an empty timeline and a workspace with no date property", async () => {
  stubTimeline(() => json({ timeline: { ...timeline, entries: [], total: 0, dateProperties: 0 } }));
  render(<DashboardTimeline />);
  assert.ok(
    await screen.findByText("Add a date property to a database to build a timeline."),
  );

  cleanup();

  stubTimeline(() => json({ timeline: { ...timeline, entries: [], total: 0, dateProperties: 2 } }));
  render(<DashboardTimeline />);
  assert.ok(
    await screen.findByText("No dated records in the last 7 days or the next 30."),
  );
});

test("offers a retry when the timeline cannot load", async () => {
  const calls = stubTimeline(() => json({ error: "nope" }, 500));
  render(<DashboardTimeline />);

  assert.ok(await screen.findByRole("alert"));
  assert.ok(screen.getByText("Could not load your timeline."));

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));

  await waitFor(() => assert.ok(calls.length >= 2));
});
