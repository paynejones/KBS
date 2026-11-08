import "../setup-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DashboardQueues } from "../../src/components/dashboard-queues";
import { json, restoreFetch, stubFetch } from "./fetch-stub";

const QUEUES_KEY = "kbs:dashboard-queues";

function offsetDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const databases = [
  {
    id: "db-tasks",
    name: "Tasks",
    properties: [
      { id: "due", name: "Due", type: "date" },
      { id: "status", name: "Status", type: "select" },
    ],
  },
  { id: "db-notes", name: "Notes", properties: [{ id: "body", name: "Body", type: "text" }] },
  {
    id: "db-projects",
    name: "Projects",
    properties: [
      { id: "stage", name: "Stage", type: "select", choices: ["Planning", "In progress", "Done"] },
    ],
  },
];

const taskQueue = {
  databaseId: "db-tasks",
  databaseName: "Tasks",
  property: { id: "due", name: "Due" },
  statusProperty: { id: "status", name: "Status" },
  records: [
    { id: "task-1", title: "Overdue report", due: offsetDate(-2), bucket: "overdue" },
    { id: "task-2", title: "Today review", due: offsetDate(0), bucket: "today" },
    { id: "task-3", title: "Tomorrow plan", due: offsetDate(1), bucket: "soon" },
  ],
  total: 3,
  overdue: 1,
};

const projectQueue = {
  databaseId: "db-projects",
  databaseName: "Projects",
  property: { id: "stage", name: "Stage" },
  records: [
    { id: "project-1", title: "Portfolio", status: "In progress" },
    { id: "project-2", title: "Garden", status: "" },
  ],
  total: 2,
};

async function waitForDatabaseOptions() {
  await waitFor(() => {
    const select = screen.getByLabelText("Task database") as HTMLSelectElement;
    assert.ok(
      Array.from(select.options).some((option) => option.value === "db-tasks"),
      "database options load before a choice is made",
    );
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  restoreFetch();
  cleanup();
});

test("choosing a database and property remembers the due-soon queue", async () => {
  const calls = stubFetch((call) =>
    call.url.includes("taskPropertyId=due")
      ? json({ databases, tasks: taskQueue, projects: null })
      : json({ databases, tasks: null, projects: null }),
  );

  render(<DashboardQueues />);

  assert.ok(await screen.findByLabelText("Task database"));
  assert.ok(screen.getByRole("heading", { name: "Due soon" }));
  assert.ok(screen.getByRole("heading", { name: "Current projects" }));
  assert.equal(
    screen.queryByLabelText("Due date property"),
    null,
    "the property picker waits for a database",
  );

  await waitForDatabaseOptions();
  fireEvent.change(screen.getByLabelText("Task database"), {
    target: { value: "db-tasks" },
  });

  assert.deepEqual(JSON.parse(window.localStorage.getItem(QUEUES_KEY) ?? "null"), {
    tasks: { databaseId: "db-tasks", propertyId: "" },
    projects: null,
  });
  const property = await screen.findByLabelText("Due date property");

  fireEvent.change(property, { target: { value: "due" } });

  assert.deepEqual(JSON.parse(window.localStorage.getItem(QUEUES_KEY) ?? "null"), {
    tasks: { databaseId: "db-tasks", propertyId: "due" },
    projects: null,
  });
  assert.ok(await screen.findByRole("link", { name: "Overdue report" }));
  assert.ok(screen.getByText("2d overdue"));
  assert.ok(screen.getByText("Today"));
  assert.ok(screen.getByText("1 overdue"));
  assert.ok(
    calls.some(
      (call) =>
        call.url.includes("taskDatabaseId=db-tasks") &&
        call.url.includes("taskPropertyId=due"),
    ),
  );

  fireEvent.change(screen.getByLabelText("Done status"), {
    target: { value: "status" },
  });

  assert.deepEqual(JSON.parse(window.localStorage.getItem(QUEUES_KEY) ?? "null"), {
    tasks: {
      databaseId: "db-tasks",
      propertyId: "due",
      statusPropertyId: "status",
    },
    projects: null,
  });
  await waitFor(() =>
    assert.ok(
      calls.some((call) => call.url.includes("taskStatusPropertyId=status")),
      "the chosen done-status property reaches the API",
    ),
  );

  fireEvent.change(screen.getByLabelText("Done status"), {
    target: { value: "none" },
  });
  await waitFor(() =>
    assert.ok(calls.some((call) => call.url.includes("taskStatusPropertyId=none"))),
  );
});

test("a saved queue renders its rows with the chosen sources", async () => {
  window.localStorage.setItem(
    QUEUES_KEY,
    JSON.stringify({
      tasks: { databaseId: "db-tasks", propertyId: "due" },
      projects: { databaseId: "db-projects", propertyId: "" },
    }),
  );
  const calls = stubFetch(() =>
    json({ databases, tasks: taskQueue, projects: projectQueue }),
  );

  render(<DashboardQueues />);

  assert.ok(await screen.findByRole("link", { name: "Overdue report" }));
  assert.equal(
    (screen.getByLabelText("Task database") as HTMLSelectElement).value,
    "db-tasks",
  );
  assert.equal(
    screen.getByRole("link", { name: "Overdue report" }).getAttribute("href"),
    "/databases/db-tasks/records/task-1",
  );
  assert.ok(screen.getByText("View all 3 due"));

  const portfolioRow = (await screen.findByRole("link", { name: "Portfolio" })).closest("li");
  assert.ok(portfolioRow);
  assert.match(portfolioRow.textContent ?? "", /In progress/);
  assert.ok(screen.getByText("No status"));
  assert.ok(screen.getByText("View all 2 projects"));
  assert.ok(calls.some((call) => call.url.includes("projectDatabaseId=db-projects")));
});

test("the project queue skips a chosen set of statuses", async () => {
  window.localStorage.setItem(
    QUEUES_KEY,
    JSON.stringify({ tasks: null, projects: { databaseId: "db-projects", propertyId: "" } }),
  );
  const calls = stubFetch(() => json({ databases, tasks: null, projects: projectQueue }));

  render(<DashboardQueues />);

  const done = await screen.findByRole("button", { name: "Done" });
  assert.equal(done.getAttribute("aria-pressed"), "false");

  fireEvent.click(done);

  assert.deepEqual(JSON.parse(window.localStorage.getItem(QUEUES_KEY) ?? "null"), {
    tasks: null,
    projects: {
      databaseId: "db-projects",
      propertyId: "",
      excludedStatuses: ["Done"],
    },
  });
  await waitFor(() =>
    assert.ok(calls.some((call) => call.url.includes("projectExcludedStatus=Done"))),
  );

  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  assert.deepEqual(JSON.parse(window.localStorage.getItem(QUEUES_KEY) ?? "null"), {
    tasks: null,
    projects: { databaseId: "db-projects", propertyId: "" },
  });
});

test("a database without a date property explains what is missing", async () => {
  stubFetch(() => json({ databases, tasks: null, projects: null }));

  render(<DashboardQueues />);

  await screen.findByLabelText("Task database");
  await waitForDatabaseOptions();
  fireEvent.change(screen.getByLabelText("Task database"), {
    target: { value: "db-notes" },
  });

  assert.ok(await screen.findByText("This database has no date property yet."));
  assert.equal(
    (screen.getByLabelText("Due date property") as HTMLSelectElement).disabled,
    true,
  );
});
