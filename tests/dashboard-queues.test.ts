import assert from "node:assert/strict";
import test from "node:test";
import {
  DUE_SOON_DAYS,
  daysUntil,
  describeDue,
  dueBucket,
  isCompletedStatus,
  isExcludedStatus,
  NO_STATUS_FILTER,
  parseDashboardQueues,
  parseQueueConfig,
  setQueueConfig,
} from "../src/lib/dashboard-queues";

const DATABASE = "11111111-1111-4111-8111-111111111111";
const PROPERTY = "22222222-2222-4222-8222-222222222222";

test("queue configuration parses defensively", () => {
  assert.equal(parseQueueConfig(null), null);
  assert.equal(parseQueueConfig("tasks"), null);
  assert.equal(parseQueueConfig([]), null);
  assert.equal(parseQueueConfig({ propertyId: PROPERTY }), null);
  assert.equal(parseQueueConfig({ databaseId: "" }), null);
  assert.equal(parseQueueConfig({ databaseId: 42 }), null);
  assert.deepEqual(
    parseQueueConfig({ databaseId: DATABASE, propertyId: PROPERTY }),
    { databaseId: DATABASE, propertyId: PROPERTY },
  );
  assert.deepEqual(
    parseQueueConfig({ databaseId: DATABASE, propertyId: 7 }),
    { databaseId: DATABASE, propertyId: "" },
    "a malformed property falls back to unchosen",
  );
});

test("a task queue remembers which status marks work as finished", () => {
  assert.equal(NO_STATUS_FILTER, "none");
  assert.deepEqual(
    parseQueueConfig({
      databaseId: DATABASE,
      propertyId: PROPERTY,
      statusPropertyId: NO_STATUS_FILTER,
    }),
    { databaseId: DATABASE, propertyId: PROPERTY, statusPropertyId: NO_STATUS_FILTER },
  );

  const automatic = parseQueueConfig({
    databaseId: DATABASE,
    propertyId: PROPERTY,
    statusPropertyId: "",
  });
  assert.deepEqual(automatic, { databaseId: DATABASE, propertyId: PROPERTY });
  assert.equal(
    "statusPropertyId" in automatic,
    false,
    "an automatic choice is stored as no choice",
  );

  assert.deepEqual(
    parseQueueConfig({ databaseId: DATABASE, propertyId: PROPERTY, statusPropertyId: 12 }),
    { databaseId: DATABASE, propertyId: PROPERTY },
    "a malformed status choice falls back to automatic",
  );
});

test("a project queue can replace the finished-status vocabulary", () => {
  assert.equal(isExcludedStatus("In Progress", ["in progress"]), true);
  assert.equal(isExcludedStatus("Planning", ["in progress"]), false);
  assert.equal(isExcludedStatus("", [""]), false);
  assert.equal(isExcludedStatus(null, ["done"]), false);

  assert.deepEqual(
    parseQueueConfig({
      databaseId: DATABASE,
      propertyId: PROPERTY,
      excludedStatuses: ["Done", " done ", "Archived", 7, ""],
    }),
    { databaseId: DATABASE, propertyId: PROPERTY, excludedStatuses: ["Done", "Archived"] },
    "chosen statuses are trimmed and deduplicated without case",
  );

  const automatic = parseQueueConfig({
    databaseId: DATABASE,
    propertyId: PROPERTY,
    excludedStatuses: [],
  });
  assert.ok(automatic);
  assert.equal(
    "excludedStatuses" in automatic,
    false,
    "no chosen statuses keeps the built-in vocabulary",
  );
});

test("stored dashboard queues ignore malformed entries", () => {
  assert.deepEqual(parseDashboardQueues(null), { tasks: null, projects: null });
  assert.deepEqual(parseDashboardQueues("not json"), { tasks: null, projects: null });
  assert.deepEqual(parseDashboardQueues("[1,2]"), { tasks: null, projects: null });
  assert.deepEqual(parseDashboardQueues(JSON.stringify({ tasks: "yes" })), {
    tasks: null,
    projects: null,
  });
  assert.deepEqual(
    parseDashboardQueues(
      JSON.stringify({
        tasks: { databaseId: DATABASE, propertyId: PROPERTY },
        projects: { databaseId: "" },
      }),
    ),
    { tasks: { databaseId: DATABASE, propertyId: PROPERTY }, projects: null },
  );
});

test("setting one queue leaves the other alone", () => {
  const tasks = { databaseId: DATABASE, propertyId: PROPERTY };
  const projects = { databaseId: DATABASE, propertyId: "" };

  assert.deepEqual(setQueueConfig({ tasks, projects: null }, "projects", projects), {
    tasks,
    projects,
  });
  assert.deepEqual(setQueueConfig({ tasks, projects }, "tasks", null), {
    tasks: null,
    projects,
  });
  assert.deepEqual(
    setQueueConfig({ tasks, projects }, "tasks", { databaseId: "", propertyId: "" }),
    { tasks: null, projects },
  );
});

test("due buckets separate overdue, today, and the coming week", () => {
  assert.equal(dueBucket("2026-03-09", "2026-03-10"), "overdue");
  assert.equal(dueBucket("2026-03-10", "2026-03-10"), "today");
  assert.equal(dueBucket("2026-03-11", "2026-03-10"), "soon");
  assert.equal(
    dueBucket("2026-03-17", "2026-03-10"),
    "soon",
    `the horizon includes day ${DUE_SOON_DAYS}`,
  );
  assert.equal(dueBucket("2026-03-18", "2026-03-10"), null);
  assert.equal(dueBucket("", "2026-03-10"), null);
  assert.equal(dueBucket("2026-02-31", "2026-03-10"), null, "impossible dates are ignored");
});

test("due dates count whole days and read naturally", () => {
  assert.equal(daysUntil("2026-03-10", "2026-03-10"), 0);
  assert.equal(daysUntil("2026-03-17", "2026-03-10"), 7);
  assert.equal(daysUntil("2026-03-01", "2026-03-10"), -9);
  assert.equal(daysUntil("not a date", "2026-03-10"), null);
  assert.equal(describeDue("2026-03-08", "2026-03-10"), "2d overdue");
  assert.equal(describeDue("2026-03-10", "2026-03-10"), "Today");
  assert.equal(describeDue("2026-03-11", "2026-03-10"), "Tomorrow");
  assert.equal(describeDue("2026-03-14", "2026-03-10"), "in 4d");
  assert.equal(describeDue("", "2026-03-10"), "");
});

test("completed statuses are recognised across common spellings", () => {
  for (const status of [
    "Done",
    "complete",
    "Completed",
    "Finished",
    "Shipped",
    "Archived",
    "Dropped",
    "canceled",
  ]) {
    assert.equal(isCompletedStatus(status), true, status);
  }
  for (const status of ["", "Todo", "In progress", "Waiting", "Planned", null, 3]) {
    assert.equal(isCompletedStatus(status), false, String(status));
  }
});
