import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeNavigationKey,
  DEFAULT_MOBILE_ITEMS,
  DEFAULT_SIDEBAR_ORDER,
  defaultNavigationPreferences,
  MOBILE_NAVIGATION_LIMIT,
  mobileNavigationWithActive,
  moveNavigationKeyBy,
  moveNavigationKeyTo,
  NAVIGATION_KEYS,
  normalizeSidebarOrder,
  parseNavigationPreferences,
  toggleMobileNavigationItem,
} from "../src/lib/navigation";

test("defaults list every destination once", () => {
  const preferences = defaultNavigationPreferences();

  assert.deepEqual(preferences.sidebar, NAVIGATION_KEYS);
  assert.deepEqual(preferences.mobile, DEFAULT_MOBILE_ITEMS);
  assert.equal(preferences.mobile.length, MOBILE_NAVIGATION_LIMIT);
  assert.equal(DEFAULT_SIDEBAR_ORDER.length, 7);
});

test("defaults are fresh arrays, so callers cannot mutate the constants", () => {
  const first = defaultNavigationPreferences();
  first.sidebar.pop();
  first.mobile.pop();

  assert.equal(defaultNavigationPreferences().sidebar.length, 7);
  assert.equal(defaultNavigationPreferences().mobile.length, 4);
});

test("a saved order is restored as written", () => {
  const saved = {
    sidebar: [
      "trash",
      "home",
      "pages",
      "inbox",
      "databases",
      "favorites",
      "graph",
    ],
    mobile: ["inbox", "home"],
  };

  const preferences = parseNavigationPreferences(JSON.stringify(saved));

  assert.deepEqual(preferences.sidebar, saved.sidebar);
  assert.deepEqual(preferences.mobile, saved.mobile);
});

test("unknown and duplicate destinations are dropped, missing ones appended", () => {
  const preferences = parseNavigationPreferences(
    JSON.stringify({
      sidebar: ["graph", "graph", "settings", 42, "home"],
      mobile: ["graph", "graph", "nowhere"],
    }),
  );

  assert.deepEqual(preferences.sidebar.slice(0, 2), ["graph", "home"]);
  assert.equal(preferences.sidebar.length, 7);
  assert.deepEqual([...preferences.sidebar].sort(), [...NAVIGATION_KEYS].sort());
  assert.deepEqual(preferences.mobile, ["graph"]);
});

test("the bottom bar is capped at four destinations", () => {
  const preferences = parseNavigationPreferences(
    JSON.stringify({
      mobile: ["home", "pages", "inbox", "databases", "graph", "trash"],
    }),
  );

  assert.deepEqual(preferences.mobile, ["home", "pages", "inbox", "databases"]);
});

test("malformed storage falls back to defaults", () => {
  for (const raw of [null, "", "not json", "[]", "null", '{"sidebar":5}']) {
    const preferences = parseNavigationPreferences(raw);

    assert.deepEqual(preferences.sidebar, NAVIGATION_KEYS);
    assert.deepEqual(preferences.mobile, DEFAULT_MOBILE_ITEMS);
  }
});

test("an empty sidebar order is refilled from the defaults", () => {
  assert.deepEqual(normalizeSidebarOrder([]), NAVIGATION_KEYS);
  assert.deepEqual(
    parseNavigationPreferences(JSON.stringify({ mobile: [] })).mobile,
    DEFAULT_MOBILE_ITEMS,
  );
});

test("moving a destination respects the ends of the list", () => {
  const order = [...NAVIGATION_KEYS];

  assert.deepEqual(moveNavigationKeyBy(order, "pages", "up"), [
    "pages",
    "home",
    "inbox",
    "databases",
    "favorites",
    "graph",
    "trash",
  ]);
  assert.deepEqual(moveNavigationKeyBy(order, "home", "up"), order);
  assert.deepEqual(moveNavigationKeyBy(order, "trash", "down"), order);
});

test("dropping onto another destination moves to its index", () => {
  const order = [...NAVIGATION_KEYS];

  assert.deepEqual(moveNavigationKeyTo(order, "trash", "home"), [
    "trash",
    "home",
    "pages",
    "inbox",
    "databases",
    "favorites",
    "graph",
  ]);
  assert.equal(moveNavigationKeyTo(order, "trash", "trash"), order);
});

test("bottom-bar toggles add, remove, and never drop below one", () => {
  assert.deepEqual(toggleMobileNavigationItem(["home", "pages"], "graph"), [
    "home",
    "pages",
    "graph",
  ]);
  assert.deepEqual(toggleMobileNavigationItem(["home", "pages"], "home"), [
    "pages",
  ]);
  assert.deepEqual(toggleMobileNavigationItem(["home"], "home"), ["home"]);
  assert.deepEqual(
    toggleMobileNavigationItem(
      ["home", "pages", "inbox", "databases"],
      "graph",
    ),
    ["home", "pages", "inbox", "databases"],
  );
});

test("the active destination matches nested routes but not the home prefix", () => {
  assert.equal(activeNavigationKey("/"), "home");
  assert.equal(activeNavigationKey("/pages"), "pages");
  assert.equal(activeNavigationKey("/pages/123"), "pages");
  assert.equal(activeNavigationKey("/databases/123"), "databases");
  assert.equal(activeNavigationKey("/unknown"), null);
});

test("a hidden active destination is appended so the bar keeps its place", () => {
  assert.deepEqual(mobileNavigationWithActive(["home", "pages"], "trash"), [
    "home",
    "pages",
    "trash",
  ]);
  assert.deepEqual(mobileNavigationWithActive(["home", "pages"], "home"), [
    "home",
    "pages",
  ]);
  assert.deepEqual(mobileNavigationWithActive(["home"], null), ["home"]);
});
