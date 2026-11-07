export type NavigationKey =
  | "home"
  | "pages"
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

export type NavigationPreferences = {
  sidebar: NavigationKey[];
  mobile: NavigationKey[];
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
    mobile: [...DEFAULT_MOBILE_ITEMS],
  };
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

  return {
    sidebar: normalizeSidebarOrder(candidate.sidebar),
    mobile: normalizeMobileItems(candidate.mobile),
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
  const normalized: NavigationPreferences = {
    sidebar: normalizeSidebarOrder(preferences.sidebar),
    mobile: normalizeMobileItems(preferences.mobile),
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
