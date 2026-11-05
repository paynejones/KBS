import assert from "node:assert/strict";
import test from "node:test";
import {
  addWidget,
  DASHBOARD_WIDGET_LIMIT,
  parseDashboardWidgets,
  removeWidget,
} from "../src/lib/dashboard";

const VIEW_A = "11111111-1111-4111-8111-111111111111";
const VIEW_B = "22222222-2222-4222-8222-222222222222";
const VIEW_C = "33333333-3333-4333-8333-333333333333";
const DATABASE = "44444444-4444-4444-8444-444444444444";

test("dashboard widgets parse defensively", () => {
  assert.deepEqual(parseDashboardWidgets(null), []);
  assert.deepEqual(parseDashboardWidgets("not json"), []);
  assert.deepEqual(parseDashboardWidgets('{"viewId":"x"}'), []);
  assert.deepEqual(
    parseDashboardWidgets(JSON.stringify([
      { viewId: VIEW_A, databaseId: DATABASE },
      { viewId: VIEW_A, databaseId: DATABASE },
      { viewId: VIEW_B },
      { viewId: "", databaseId: DATABASE },
    ])),
    [{ viewId: VIEW_A, databaseId: DATABASE }],
  );
});

test("dashboard widgets are capped and newest first", () => {
  const widgets = [1, 2, 3, 4, 5, 6].map((index) => ({
    viewId: `view-${index}`,
    databaseId: DATABASE,
  }));

  assert.equal(parseDashboardWidgets(JSON.stringify(widgets)).length, DASHBOARD_WIDGET_LIMIT);

  const added = addWidget([{ viewId: VIEW_A, databaseId: DATABASE }], { viewId: VIEW_B, databaseId: DATABASE });
  assert.deepEqual(added.map((widget) => widget.viewId), [VIEW_B, VIEW_A]);
});

test("adding an existing widget moves it to the front without duplicating", () => {
  const added = addWidget(
    [{ viewId: VIEW_A, databaseId: DATABASE }, { viewId: VIEW_B, databaseId: DATABASE }],
    { viewId: VIEW_B, databaseId: DATABASE },
  );

  assert.deepEqual(added.map((widget) => widget.viewId), [VIEW_B, VIEW_A]);
});

test("removing a widget leaves the rest in order", () => {
  const remaining = removeWidget(
    [{ viewId: VIEW_A, databaseId: DATABASE }, { viewId: VIEW_C, databaseId: DATABASE }],
    VIEW_A,
  );

  assert.deepEqual(remaining.map((widget) => widget.viewId), [VIEW_C]);
  assert.deepEqual(removeWidget([], VIEW_A), []);
});

test("invalid widgets are ignored by addWidget", () => {
  const existing = [{ viewId: VIEW_A, databaseId: DATABASE }];

  assert.deepEqual(addWidget(existing, { viewId: "", databaseId: DATABASE }), existing);
  assert.deepEqual(addWidget(existing, { viewId: VIEW_B, databaseId: "" }), existing);
});

test("addWidget honors an explicit limit", () => {
  const widgets = [
    { viewId: VIEW_A, databaseId: DATABASE },
    { viewId: VIEW_B, databaseId: DATABASE },
  ];

  assert.deepEqual(
    addWidget(widgets, { viewId: VIEW_C, databaseId: DATABASE }, 1).map((widget) => widget.viewId),
    [VIEW_C],
  );
});

test("removing an unknown widget is a no-op", () => {
  const widgets = [{ viewId: VIEW_A, databaseId: DATABASE }];
  assert.deepEqual(removeWidget(widgets, VIEW_B), widgets);
});
