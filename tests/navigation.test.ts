import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeNavigationKey,
  addSidebarEntry,
  DEFAULT_MOBILE_ITEMS,
  DEFAULT_SIDEBAR_ORDER,
  defaultNavigationPreferences,
  defaultSidebarSections,
  MOBILE_NAVIGATION_LIMIT,
  mobileNavigationWithActive,
  moveNavigationKeyBy,
  moveNavigationKeyTo,
  moveSidebarEntry,
  moveSidebarEntryTo,
  moveSidebarSection,
  moveSidebarSectionTo,
  NAVIGATION_KEYS,
  normalizeSidebarOrder,
  normalizeSidebarSections,
  parseNavigationPreferences,
  removeSidebarEntry,
  removeSidebarSection,
  setNavigationLocked,
  sidebarEntryKey,
  toggleHiddenNavigationKey,
  type SidebarSection,
  toggleMobileNavigationItem,
  visibleSidebarKeys,
} from "../src/lib/navigation";
import { isViewMode, viewModeHref } from "../src/lib/view-mode";

test("defaults list every destination once", () => {
  const preferences = defaultNavigationPreferences();

  assert.deepEqual(preferences.sidebar, NAVIGATION_KEYS);
  assert.deepEqual(preferences.hidden, []);
  assert.deepEqual(preferences.mobile, DEFAULT_MOBILE_ITEMS);
  assert.equal(preferences.mobile.length, MOBILE_NAVIGATION_LIMIT);
  assert.equal(preferences.showDatabasePages, false);
  assert.equal(preferences.locked, false);
  assert.equal(DEFAULT_SIDEBAR_ORDER.length, 10);
});

test("navigation can be locked without changing the sidebar", () => {
  const preferences = defaultNavigationPreferences();
  const locked = setNavigationLocked(preferences, true);

  assert.equal(locked.locked, true);
  assert.deepEqual(locked.sections, preferences.sections);
  assert.deepEqual(locked.mobile, preferences.mobile);

  assert.equal(
    parseNavigationPreferences(JSON.stringify(locked)).locked,
    true,
    "the lock survives a saved round trip",
  );
  assert.equal(setNavigationLocked(locked, false).locked, false);
  assert.equal(
    parseNavigationPreferences(JSON.stringify({ sidebar: ["home"] })).locked,
    false,
    "older preferences are unlocked",
  );
});

test("defaults are fresh arrays, so callers cannot mutate the constants", () => {
  const first = defaultNavigationPreferences();
  first.sidebar.pop();
  first.mobile.pop();

  assert.equal(defaultNavigationPreferences().sidebar.length, 10);
  assert.equal(defaultNavigationPreferences().mobile.length, 4);
});

test("default sections keep every destination and the Pages tree", () => {
  const sections = defaultSidebarSections();

  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, "Workspace");
  assert.deepEqual(
    sections[0].entries.slice(0, NAVIGATION_KEYS.length),
    NAVIGATION_KEYS.map((key) => ({ kind: "navigation", key })),
  );
  assert.deepEqual(sections[0].entries.at(-1), { kind: "page-tree" });
  assert.deepEqual(
    defaultNavigationPreferences().sections,
    sections,
    "new preferences start with the default section",
  );
});

test("older preferences gain a default section from their saved order", () => {
  const preferences = parseNavigationPreferences(
    JSON.stringify({ sidebar: ["trash", "home"], mobile: ["home"] }),
  );

  assert.equal(preferences.sections.length, 1);
  assert.deepEqual(preferences.sections[0].entries.slice(0, 2), [
    { kind: "navigation", key: "trash" },
    { kind: "navigation", key: "home" },
  ]);
  assert.deepEqual(preferences.sections[0].entries.at(-1), { kind: "page-tree" });
});

test("custom sections drop duplicates and unknown entries", () => {
  const pageId = "11111111-1111-4111-8111-111111111111";
  const databaseId = "22222222-2222-4222-8222-222222222222";
  const sections = normalizeSidebarSections([
    {
      id: "project",
      name: "  Projects  ",
      entries: [
        { kind: "navigation", key: "home" },
        { kind: "page", id: pageId },
        { kind: "page", id: pageId },
        { kind: "page-tree" },
        { kind: "page-tree" },
        { kind: "database", id: databaseId },
        { kind: "database", id: "not-a-uuid" },
        { kind: "unknown" },
      ],
    },
  ]);

  assert.equal(sections[0].name, "Projects");
  assert.deepEqual(sections[0].entries, [
    { kind: "navigation", key: "home" },
    { kind: "page", id: pageId },
    { kind: "page-tree" },
    { kind: "database", id: databaseId },
  ]);
  assert.equal(sidebarEntryKey(sections[0].entries[1]), `page:${pageId}`);
});

test("entries can move between sections and reorder", () => {
  const pageId = "33333333-3333-4333-8333-333333333333";
  const sections = [
    {
      id: "one",
      name: "One",
      entries: [
        { kind: "navigation" as const, key: "home" as const },
        { kind: "navigation" as const, key: "pages" as const },
      ],
    },
    {
      id: "two",
      name: "Two",
      entries: [{ kind: "page" as const, id: pageId }],
    },
  ];

  const moved = addSidebarEntry(sections, "two", {
    kind: "navigation",
    key: "home",
  });

  assert.deepEqual(moved[0].entries, [{ kind: "navigation", key: "pages" }]);
  assert.deepEqual(moved[1].entries, [
    { kind: "page", id: pageId },
    { kind: "navigation", key: "home" },
  ]);

  const reordered = moveSidebarEntry(moved, "two", "navigation:home", "up");
  assert.equal(sidebarEntryKey(reordered[1].entries[0]), "navigation:home");
  assert.deepEqual(moveSidebarSection(reordered, "two", "up").map((section) => section.id), ["two", "one"]);
  assert.deepEqual(removeSidebarEntry(reordered, "two", "navigation:home")[1].entries, [
    { kind: "page", id: pageId },
  ]);
  assert.deepEqual(removeSidebarSection(reordered, "one").map((section) => section.id), ["two"]);
});

test("drag helpers reorder entries within and across sections", () => {
  const pageId = "44444444-4444-4444-8444-444444444444";
  const sections: SidebarSection[] = [
    {
      id: "one",
      name: "One",
      entries: [
        { kind: "navigation", key: "home" },
        { kind: "navigation", key: "pages" },
      ],
    },
    {
      id: "two",
      name: "Two",
      entries: [{ kind: "page", id: pageId }],
    },
  ];

  const reordered = moveSidebarEntryTo(
    sections,
    "navigation:pages",
    "one",
    "navigation:home",
    "before",
  );
  assert.deepEqual(reordered[0].entries, [
    { kind: "navigation", key: "pages" },
    { kind: "navigation", key: "home" },
  ]);

  const moved = moveSidebarEntryTo(
    reordered,
    "navigation:home",
    "two",
    null,
  );
  assert.deepEqual(moved[0].entries, [{ kind: "navigation", key: "pages" }]);
  assert.deepEqual(moved[1].entries, [
    { kind: "page", id: pageId },
    { kind: "navigation", key: "home" },
  ]);

  const inserted = moveSidebarEntryTo(
    moved,
    "navigation:pages",
    "two",
    `page:${pageId}`,
    "after",
  );
  assert.deepEqual(inserted[1].entries, [
    { kind: "page", id: pageId },
    { kind: "navigation", key: "pages" },
    { kind: "navigation", key: "home" },
  ]);
});

test("drag helpers reorder whole sections", () => {
  const sections: SidebarSection[] = [
    { id: "a", name: "A", entries: [] },
    { id: "b", name: "B", entries: [] },
    { id: "c", name: "C", entries: [] },
  ];

  assert.deepEqual(
    moveSidebarSectionTo(sections, "c", "a", "before").map(
      (section) => section.id,
    ),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    moveSidebarSectionTo(sections, "a", "c", "after").map(
      (section) => section.id,
    ),
    ["b", "c", "a"],
  );
  assert.equal(moveSidebarSectionTo(sections, "a", "a"), sections);
});

test("an explicitly empty section list stays empty", () => {
  assert.deepEqual(
    parseNavigationPreferences(JSON.stringify({ sections: [] })).sections,
    [],
    "removing every section must survive a reload",
  );
});

test("a saved order is restored as written", () => {
  const saved = {
    sidebar: [
      "trash",
      "home",
      "pages",
      "searches",
      "reading",
      "focus",
      "inbox",
      "databases",
      "favorites",
      "graph",
    ],
    mobile: ["inbox", "home"],
  };

  const preferences = parseNavigationPreferences(JSON.stringify(saved));

  assert.deepEqual(preferences.sidebar, saved.sidebar);
  assert.deepEqual(preferences.hidden, [], "older saved preferences hide nothing");
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
  assert.equal(preferences.sidebar.length, 10);
  assert.deepEqual([...preferences.sidebar].sort(), [...NAVIGATION_KEYS].sort());
  assert.deepEqual(preferences.mobile, ["graph"]);
});

test("hidden destinations are deduplicated and filtered from the sidebar", () => {
  const preferences = parseNavigationPreferences(
    JSON.stringify({
      hidden: ["focus", "focus", "nope", 42, "trash"],
      mobile: ["home", "pages", "inbox", "databases"],
    }),
  );

  assert.deepEqual(preferences.hidden, ["focus", "trash"]);
  assert.deepEqual(
    visibleSidebarKeys(preferences),
    NAVIGATION_KEYS.filter((key) => key !== "focus" && key !== "trash"),
  );
  assert.deepEqual(
    preferences.mobile,
    ["home", "pages", "inbox", "databases"],
    "hiding a sidebar destination does not change the bottom bar",
  );
});

test("hiding a destination toggles it back into the sidebar", () => {
  const hidden = toggleHiddenNavigationKey([], "focus");

  assert.deepEqual(hidden, ["focus"]);
  assert.deepEqual(toggleHiddenNavigationKey(hidden, "focus"), []);
  assert.deepEqual(toggleHiddenNavigationKey(["trash"], "focus"), [
    "trash",
    "focus",
  ]);
});

test("database pages stay hidden until the shared preference is enabled", () => {
  assert.equal(
    parseNavigationPreferences(JSON.stringify({ mobile: ["home"] }))
      .showDatabasePages,
    false,
    "older preferences keep database pages hidden",
  );
  assert.equal(
    parseNavigationPreferences(JSON.stringify({ showDatabasePages: true }))
      .showDatabasePages,
    true,
  );
  assert.equal(
    parseNavigationPreferences(JSON.stringify({ showDatabasePages: "yes" }))
      .showDatabasePages,
    false,
    "only a real boolean enables database pages",
  );
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
    "searches",
    "reading",
    "focus",
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
    "searches",
    "reading",
    "focus",
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

test("view mode is URL-backed without dropping other query state", () => {
  assert.equal(isViewMode("?mode=view"), true);
  assert.equal(isViewMode("?mode=edit"), false);
  assert.equal(isViewMode(""), false);
  assert.equal(
    viewModeHref("/databases/one", "?view=saved&filterValue=Open", true),
    "/databases/one?view=saved&filterValue=Open&mode=view",
  );
  assert.equal(
    viewModeHref("/databases/one", "?view=saved&mode=view", false),
    "/databases/one?view=saved",
  );
  assert.equal(viewModeHref("/pages/one", "?mode=view", false), "/pages/one");
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
