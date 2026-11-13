import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_WIDGET_IDS,
  defaultDashboardLayout,
  moveDashboardWidget,
  normalizeDashboardLayout,
  parseDashboardLayout,
  reorderDashboardWidget,
  setDashboardWidgetHidden,
  setDashboardWidgetSize,
  setDashboardLocked,
  dashboardWidgetSpan,
} from "../src/lib/dashboard-layout";

test("the default layout carries every widget in its default order", () => {
  const layout = defaultDashboardLayout();
  assert.deepEqual(layout.order, DASHBOARD_WIDGET_IDS);
  assert.deepEqual(layout.hidden, []);
  assert.deepEqual(layout.sizes, {});
  assert.equal(layout.locked, false);
});

test("normalization drops unknown and duplicate entries and appends missing widgets", () => {
  const layout = normalizeDashboardLayout({
    order: ["timeline", "nope", "timeline", "resume"],
    hidden: ["views", "views", "bogus"],
    sizes: { timeline: "full", recent: "wide", bogus: "half" },
    locked: true,
  });

  assert.deepEqual(layout.order.slice(0, 2), ["timeline", "resume"]);
  assert.deepEqual(new Set(layout.order), new Set(DASHBOARD_WIDGET_IDS));
  assert.equal(layout.order.length, DASHBOARD_WIDGET_IDS.length);
  assert.deepEqual(layout.hidden, ["views"]);
  assert.deepEqual(layout.sizes, { timeline: "full" });
  assert.equal(layout.locked, true);
});

test("malformed saved layouts fall back to the default", () => {
  assert.deepEqual(parseDashboardLayout(null), defaultDashboardLayout());
  assert.deepEqual(parseDashboardLayout("{not json"), defaultDashboardLayout());
  assert.deepEqual(parseDashboardLayout("[]"), defaultDashboardLayout());
  assert.deepEqual(normalizeDashboardLayout("nope"), defaultDashboardLayout());
});

test("moving a widget swaps it with its neighbour and ignores the ends", () => {
  const layout = defaultDashboardLayout();
  const moved = moveDashboardWidget(layout, "timeline", "up");
  assert.deepEqual(moved.order.slice(2, 4), ["timeline", "pinned-projects"]);

  assert.equal(moveDashboardWidget(layout, "resume", "up").order, layout.order);
  assert.equal(moveDashboardWidget(layout, "databases", "down").order, layout.order);
});

test("reordering moves a widget in front of a target or to the end", () => {
  const layout = defaultDashboardLayout();

  const before = reorderDashboardWidget(layout, "views", "resume");
  assert.equal(before.order[0], "views");
  assert.equal(before.order.filter((id) => id === "views").length, 1);

  const end = reorderDashboardWidget(layout, "resume", null);
  assert.equal(end.order[end.order.length - 1], "resume");

  assert.equal(reorderDashboardWidget(layout, "views", "views").order, layout.order);
});

test("a width override falls back to the widget default and can be cleared", () => {
  const layout = defaultDashboardLayout();
  assert.equal(dashboardWidgetSpan(layout, "recent"), "half");

  const full = setDashboardWidgetSize(layout, "recent", "full");
  assert.equal(dashboardWidgetSpan(full, "recent"), "full");

  const cleared = setDashboardWidgetSize(full, "recent", "half");
  assert.deepEqual(cleared.sizes, {});
});

test("locking keeps the arrangement and can be undone", () => {
  const arranged = setDashboardWidgetHidden(
    setDashboardWidgetSize(defaultDashboardLayout(), "recent", "full"),
    "timeline",
    true,
  );

  const locked = setDashboardLocked(arranged, true);
  assert.equal(locked.locked, true);
  assert.deepEqual(locked.order, arranged.order);
  assert.deepEqual(locked.hidden, arranged.hidden);
  assert.deepEqual(locked.sizes, arranged.sizes);

  const unlocked = setDashboardLocked(locked, false);
  assert.equal(unlocked.locked, false);
  assert.deepEqual(unlocked.order, arranged.order);
});

test("hiding and restoring a widget leaves its saved position alone", () => {
  const layout = setDashboardWidgetHidden(defaultDashboardLayout(), "timeline", true);
  assert.deepEqual(layout.hidden, ["timeline"]);
  assert.deepEqual(layout.order, DASHBOARD_WIDGET_IDS);

  const restored = setDashboardWidgetHidden(layout, "timeline", false);
  assert.deepEqual(restored.hidden, []);
  assert.deepEqual(restored.order, DASHBOARD_WIDGET_IDS);
});
