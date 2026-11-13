export type NavigationKey =
  | "home"
  | "pages"
  | "searches"
  | "reading"
  | "focus"
  | "inbox"
  | "databases"
  | "favorites"
  | "graph"
  | "trash";

export type NavigationItem = {
  key: NavigationKey;
  label: string;
  href: string;
};

export const NAVIGATION_ITEMS: NavigationItem[] = [
  { key: "home", label: "Home", href: "/" },
  { key: "pages", label: "Pages", href: "/pages" },
  { key: "searches", label: "Searches", href: "/searches" },
  { key: "reading", label: "Reading", href: "/reading" },
  { key: "focus", label: "Focus", href: "/focus" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "databases", label: "Databases", href: "/databases" },
  { key: "favorites", label: "Favorites", href: "/favorites" },
  { key: "graph", label: "Graph", href: "/graph" },
  { key: "trash", label: "Trash", href: "/trash" },
];

export const NAVIGATION_KEYS: NavigationKey[] = NAVIGATION_ITEMS.map(
  (item) => item.key,
);

export const DEFAULT_SIDEBAR_ORDER: NavigationKey[] = [...NAVIGATION_KEYS];

/** The four destinations the bottom bar shows before anyone customizes it. */
export const DEFAULT_MOBILE_ITEMS: NavigationKey[] = [
  "home",
  "pages",
  "databases",
  "inbox",
];

export const MOBILE_NAVIGATION_LIMIT = 4;

export const NAVIGATION_STORAGE_KEY = "kbs:navigation";
export const NAVIGATION_UPDATED_EVENT = "kbs:navigation-updated";

export type SidebarEntry =
  | { kind: "navigation"; key: NavigationKey }
  | { kind: "page-tree" }
  | { kind: "page"; id: string }
  | { kind: "database"; id: string };

export type SidebarSection = {
  id: string;
  name: string;
  entries: SidebarEntry[];
};

export type NavigationPreferences = {
  sidebar: NavigationKey[];
  hidden: NavigationKey[];
  mobile: NavigationKey[];
  /** Record pages stay out of navigation and listings unless this is on. */
  showDatabasePages: boolean;
  /** The editable desktop sidebar. Empty means the user removed every section. */
  sections: SidebarSection[];
  /** A locked sidebar hides the editor entry points until it is unlocked. */
  locked: boolean;
};

export function isNavigationKey(value: unknown): value is NavigationKey {
  return (
    typeof value === "string" &&
    (NAVIGATION_KEYS as string[]).includes(value)
  );
}

export function defaultNavigationPreferences(): NavigationPreferences {
  return {
    sidebar: [...DEFAULT_SIDEBAR_ORDER],
    hidden: [],
    mobile: [...DEFAULT_MOBILE_ITEMS],
    showDatabasePages: false,
    sections: defaultSidebarSections(),
    locked: false,
  };
}

/** Locks or unlocks the navigation editor without touching the sidebar itself. */
export function setNavigationLocked(
  preferences: NavigationPreferences,
  locked: boolean,
): NavigationPreferences {
  return { ...preferences, locked };
}

function uniqueKeys(value: unknown): NavigationKey[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<NavigationKey>();

  for (const entry of value) {
    if (isNavigationKey(entry) && !seen.has(entry)) {
      seen.add(entry);
    }
  }

  return [...seen];
}

/**
 * Sidebar order always contains every destination: unknown keys, duplicates and
 * entries dropped by a rename are discarded, and any destination missing from a
 * saved order is appended in its default position.
 */
export function normalizeSidebarOrder(value: unknown): NavigationKey[] {
  const order = uniqueKeys(value);

  for (const key of NAVIGATION_KEYS) {
    if (!order.includes(key)) order.push(key);
  }

  return order;
}

const SIDEBAR_PAGE_TREE_ID = "workspace";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function defaultSidebarSections(
  sidebar: NavigationKey[] = DEFAULT_SIDEBAR_ORDER,
): SidebarSection[] {
  return [
    {
      id: SIDEBAR_PAGE_TREE_ID,
      name: "Workspace",
      entries: [
        ...sidebar.map((key) => ({ kind: "navigation" as const, key })),
        { kind: "page-tree" },
      ],
    },
  ];
}

export function sidebarEntryKey(entry: SidebarEntry): string {
  if (entry.kind === "navigation") return `navigation:${entry.key}`;
  if (entry.kind === "page-tree") return "page-tree";
  return `${entry.kind}:${entry.id}`;
}

function normalizeSidebarEntries(value: unknown): SidebarEntry[] {
  if (!Array.isArray(value)) return [];

  const entries: SidebarEntry[] = [];
  const seenNavigation = new Set<NavigationKey>();
  const seenIds = new Set<string>();
  let hasPageTree = false;

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const candidate = raw as Partial<SidebarEntry> & { kind?: unknown; key?: unknown; id?: unknown };

    if (candidate.kind === "navigation" && isNavigationKey(candidate.key) && !seenNavigation.has(candidate.key)) {
      seenNavigation.add(candidate.key);
      entries.push({ kind: "navigation", key: candidate.key });
      continue;
    }

    if (candidate.kind === "page-tree" && !hasPageTree) {
      hasPageTree = true;
      entries.push({ kind: "page-tree" });
      continue;
    }

    if (
      (candidate.kind === "page" || candidate.kind === "database") &&
      typeof candidate.id === "string" &&
      UUID_PATTERN.test(candidate.id)
    ) {
      const key = `${candidate.kind}:${candidate.id}`;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      entries.push({ kind: candidate.kind, id: candidate.id });
    }
  }

  return entries;
}

/**
 * Sections are the editable sidebar. Duplicate destinations, pages, databases,
 * and page trees are removed globally so an entry cannot render twice.
 */
export function normalizeSidebarSections(value: unknown): SidebarSection[] {
  if (!Array.isArray(value)) return defaultSidebarSections();
  if (value.length === 0) return [];

  const sections: SidebarSection[] = [];
  const seenIds = new Set<string>();
  const seenEntries = new Set<string>();

  value.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const candidate = raw as { id?: unknown; name?: unknown; entries?: unknown };
    const rawId = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 64) : "";
    let id = rawId || `section-${index + 1}`;
    let suffix = 2;
    while (seenIds.has(id)) {
      id = `${rawId || "section"}-${suffix}`;
      suffix += 1;
    }
    seenIds.add(id);

    const name =
      typeof candidate.name === "string" && candidate.name.trim()
        ? candidate.name.trim().slice(0, 40)
        : `Section ${index + 1}`;

    const entries = normalizeSidebarEntries(candidate.entries).filter((entry) => {
      const key = sidebarEntryKey(entry);
      if (seenEntries.has(key)) return false;
      seenEntries.add(key);
      return true;
    });

    sections.push({ id, name, entries });
  });

  return sections.length > 0 ? sections : defaultSidebarSections();
}

export function createSidebarSection(
  name = "New section",
  entries: SidebarEntry[] = [],
): SidebarSection {
  return {
    id: `section-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    entries,
  };
}

export function addSidebarEntry(
  sections: SidebarSection[],
  sectionId: string,
  entry: SidebarEntry,
): SidebarSection[] {
  const key = sidebarEntryKey(entry);
  const withoutEntry = sections.map((section) => ({
    ...section,
    entries: section.entries.filter((item) => sidebarEntryKey(item) !== key),
  }));

  return withoutEntry.map((section) =>
    section.id === sectionId
      ? { ...section, entries: [...section.entries, entry] }
      : section,
  );
}

export function removeSidebarEntry(
  sections: SidebarSection[],
  sectionId: string,
  entryKey: string,
): SidebarSection[] {
  return sections.map((section) =>
    section.id === sectionId
      ? { ...section, entries: section.entries.filter((entry) => sidebarEntryKey(entry) !== entryKey) }
      : section,
  );
}

export function moveSidebarEntry(
  sections: SidebarSection[],
  sectionId: string,
  entryKey: string,
  direction: "up" | "down",
): SidebarSection[] {
  return sections.map((section) => {
    if (section.id !== sectionId) return section;
    const index = section.entries.findIndex((entry) => sidebarEntryKey(entry) === entryKey);
    if (index === -1) return section;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= section.entries.length) return section;
    const entries = [...section.entries];
    [entries[index], entries[target]] = [entries[target], entries[index]];
    return { ...section, entries };
  });
}

export function moveSidebarSection(
  sections: SidebarSection[],
  sectionId: string,
  direction: "up" | "down",
): SidebarSection[] {
  const index = sections.findIndex((section) => section.id === sectionId);
  if (index === -1) return sections;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= sections.length) return sections;
  const next = [...sections];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Move an entry before/after another, including across sections. */
export function moveSidebarEntryTo(
  sections: SidebarSection[],
  entryKey: string,
  targetSectionId: string,
  targetEntryKey: string | null,
  position: "before" | "after" = "before",
): SidebarSection[] {
  if (targetEntryKey === entryKey) return sections;

  const dragged = sections
    .flatMap((section) => section.entries)
    .find((entry) => sidebarEntryKey(entry) === entryKey);
  if (!dragged) return sections;
  if (!sections.some((section) => section.id === targetSectionId)) {
    return sections;
  }

  const withoutDragged = sections.map((section) => ({
    ...section,
    entries: section.entries.filter(
      (entry) => sidebarEntryKey(entry) !== entryKey,
    ),
  }));

  return withoutDragged.map((section) => {
    if (section.id !== targetSectionId) return section;
    if (!targetEntryKey) {
      return { ...section, entries: [...section.entries, dragged] };
    }

    const targetIndex = section.entries.findIndex(
      (entry) => sidebarEntryKey(entry) === targetEntryKey,
    );
    if (targetIndex === -1) {
      return { ...section, entries: [...section.entries, dragged] };
    }

    const entries = [...section.entries];
    entries.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, dragged);
    return { ...section, entries };
  });
}

/** Move a whole section before/after another section. */
export function moveSidebarSectionTo(
  sections: SidebarSection[],
  sectionId: string,
  targetSectionId: string,
  position: "before" | "after" = "before",
): SidebarSection[] {
  const sourceIndex = sections.findIndex((section) => section.id === sectionId);
  const targetIndex = sections.findIndex(
    (section) => section.id === targetSectionId,
  );
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return sections;
  }

  const next = [...sections];
  const [moved] = next.splice(sourceIndex, 1);
  const targetAfterRemoval = next.findIndex(
    (section) => section.id === targetSectionId,
  );
  if (targetAfterRemoval === -1) return sections;

  next.splice(
    position === "after" ? targetAfterRemoval + 1 : targetAfterRemoval,
    0,
    moved,
  );
  return next;
}

export function removeSidebarSection(
  sections: SidebarSection[],
  sectionId: string,
): SidebarSection[] {
  return sections.filter((section) => section.id !== sectionId);
}

export function renameSidebarSection(
  sections: SidebarSection[],
  sectionId: string,
  name: string,
): SidebarSection[] {
  return sections.map((section) =>
    section.id === sectionId ? { ...section, name } : section,
  );
}

/** Back-compat helper for the old sidebar order; sections now drive rendering. */
export function sidebarKeysFromSections(sections: SidebarSection[]): NavigationKey[] {
  return sections.flatMap((section) =>
    section.entries.flatMap((entry) =>
      entry.kind === "navigation" ? [entry.key] : [],
    ),
  );
}

function normalizeHiddenKeys(value: unknown): NavigationKey[] {
  return uniqueKeys(value);
}

/** The sidebar shows the saved order minus destinations hidden on this device. */
export function visibleSidebarKeys(
  preferences: NavigationPreferences,
): NavigationKey[] {
  const hidden = new Set(preferences.hidden);
  return preferences.sidebar.filter((key) => !hidden.has(key));
}

export function toggleHiddenNavigationKey(
  hidden: NavigationKey[],
  key: NavigationKey,
): NavigationKey[] {
  return hidden.includes(key)
    ? hidden.filter((item) => item !== key)
    : [...hidden, key];
}

export function normalizeMobileItems(
  value: unknown,
  limit = MOBILE_NAVIGATION_LIMIT,
): NavigationKey[] {
  const items = uniqueKeys(value).slice(0, limit);

  return items.length > 0 ? items : [...DEFAULT_MOBILE_ITEMS];
}

export function parseNavigationPreferences(
  serialized: string | null,
): NavigationPreferences {
  if (!serialized) return defaultNavigationPreferences();

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return defaultNavigationPreferences();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return defaultNavigationPreferences();
  }

  const candidate = parsed as Partial<NavigationPreferences>;

  const sidebar = normalizeSidebarOrder(candidate.sidebar);

  return {
    sidebar,
    hidden: normalizeHiddenKeys(candidate.hidden),
    mobile: normalizeMobileItems(candidate.mobile),
    showDatabasePages: candidate.showDatabasePages === true,
    sections: Array.isArray(candidate.sections)
      ? normalizeSidebarSections(candidate.sections)
      : defaultSidebarSections(sidebar),
    locked: candidate.locked === true,
  };
}

export function moveNavigationKeyBy(
  order: NavigationKey[],
  key: NavigationKey,
  direction: "up" | "down",
): NavigationKey[] {
  const index = order.indexOf(key);
  if (index === -1) return order;

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return order;

  const next = [...order];
  next.splice(index, 1);
  next.splice(target, 0, key);

  return next;
}

export function moveNavigationKeyTo(
  order: NavigationKey[],
  key: NavigationKey,
  targetKey: NavigationKey,
): NavigationKey[] {
  const from = order.indexOf(key);
  const to = order.indexOf(targetKey);

  if (from === -1 || to === -1 || from === to) return order;

  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, key);

  return next;
}

/**
 * Mobile slots are chosen, not ordered: the last remaining slot cannot be
 * removed, and adding is ignored once the bar is full.
 */
export function toggleMobileNavigationItem(
  items: NavigationKey[],
  key: NavigationKey,
  limit = MOBILE_NAVIGATION_LIMIT,
): NavigationKey[] {
  if (items.includes(key)) {
    if (items.length <= 1) return items;
    return items.filter((item) => item !== key);
  }

  if (items.length >= limit) return items;

  return [...items, key];
}

export function activeNavigationKey(pathname: string): NavigationKey | null {
  for (const item of NAVIGATION_ITEMS) {
    const matches =
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(`${item.href}/`);

    if (matches) return item.key;
  }

  return null;
}

/**
 * If the current route lives outside the chosen bottom-bar destinations, it is
 * appended so the bar always answers "where am I?".
 */
export function mobileNavigationWithActive(
  items: NavigationKey[],
  activeKey: NavigationKey | null,
): NavigationKey[] {
  if (!activeKey || items.includes(activeKey)) return items;

  return [...items, activeKey];
}

const EMPTY_PREFERENCES = defaultNavigationPreferences();
let cachedRaw: string | null | undefined;
let cachedPreferences: NavigationPreferences = EMPTY_PREFERENCES;

export function getNavigationSnapshot(): NavigationPreferences {
  if (typeof window === "undefined") return EMPTY_PREFERENCES;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(NAVIGATION_STORAGE_KEY);
  } catch {
    return EMPTY_PREFERENCES;
  }

  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPreferences = parseNavigationPreferences(raw);
  }

  return cachedPreferences;
}

export function getServerNavigationSnapshot(): NavigationPreferences {
  return EMPTY_PREFERENCES;
}

export function subscribeToNavigation(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(NAVIGATION_UPDATED_EVENT, onChange);

  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(NAVIGATION_UPDATED_EVENT, onChange);
  };
}

export function storeNavigationPreferences(preferences: NavigationPreferences) {
  const sidebar = normalizeSidebarOrder(preferences.sidebar);
  const normalized: NavigationPreferences = {
    sidebar,
    hidden: normalizeHiddenKeys(preferences.hidden),
    mobile: normalizeMobileItems(preferences.mobile),
    showDatabasePages: preferences.showDatabasePages === true,
    sections: Array.isArray(preferences.sections)
      ? normalizeSidebarSections(preferences.sections)
      : defaultSidebarSections(sidebar),
    locked: preferences.locked === true,
  };

  try {
    const serialized = JSON.stringify(normalized);
    window.localStorage.setItem(NAVIGATION_STORAGE_KEY, serialized);
    cachedRaw = serialized;
    cachedPreferences = normalized;
  } catch {
    // Navigation falls back to the default order when storage is unavailable.
  }

  window.dispatchEvent(new Event(NAVIGATION_UPDATED_EVENT));
}
