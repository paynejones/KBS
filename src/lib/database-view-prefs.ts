/**
 * A database page remembers the view this browser last read and which view tabs
 * it hid. Both are reading choices rather than shared data, so they sit beside
 * the sidebar and dashboard layout in localStorage instead of a server column.
 */
const REMEMBERED_VIEW_PREFIX = "kbs:database-view:";
const HIDDEN_VIEWS_PREFIX = "kbs:database-hidden-views:";
const MAX_HIDDEN_VIEWS = 100;

export function rememberedViewStorageKey(databaseId: string): string {
  return `${REMEMBERED_VIEW_PREFIX}${databaseId}`;
}

export function hiddenViewsStorageKey(databaseId: string): string {
  return `${HIDDEN_VIEWS_PREFIX}${databaseId}`;
}

/** Stored ids are untrusted, so blanks, duplicates, and wrong types are dropped. */
export function parseHiddenViewIds(raw: string | null | undefined): string[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "string" || !entry || seen.has(entry)) continue;
    seen.add(entry);
    ids.push(entry);
    if (ids.length >= MAX_HIDDEN_VIEWS) break;
  }
  return ids;
}

export function readRememberedViewId(databaseId: string): string {
  try {
    return window.localStorage.getItem(rememberedViewStorageKey(databaseId))?.trim() ?? "";
  } catch {
    return "";
  }
}

export function rememberViewId(databaseId: string, viewId: string) {
  try {
    if (viewId) window.localStorage.setItem(rememberedViewStorageKey(databaseId), viewId);
    else window.localStorage.removeItem(rememberedViewStorageKey(databaseId));
  } catch {
    // Private-mode browsers can refuse storage; switching views still works.
  }
}

export function readHiddenViewIds(databaseId: string): string[] {
  try {
    return parseHiddenViewIds(window.localStorage.getItem(hiddenViewsStorageKey(databaseId)));
  } catch {
    return [];
  }
}

export function writeHiddenViewIds(databaseId: string, viewIds: string[]): string[] {
  const ids = parseHiddenViewIds(JSON.stringify(viewIds));
  try {
    if (ids.length > 0) {
      window.localStorage.setItem(hiddenViewsStorageKey(databaseId), JSON.stringify(ids));
    } else {
      window.localStorage.removeItem(hiddenViewsStorageKey(databaseId));
    }
  } catch {
    // The tab strip still updates for this visit.
  }
  return ids;
}

export function setViewHidden(databaseId: string, viewId: string, hidden: boolean): string[] {
  const current = readHiddenViewIds(databaseId);
  const next = hidden
    ? [...current, viewId]
    : current.filter((id) => id !== viewId);
  return writeHiddenViewIds(databaseId, next);
}

/**
 * The view a database page opens on: an explicit link wins, then the view this
 * browser last used there, then the table view, and finally the first visible
 * view. A hidden view is skipped unless a link names it directly.
 */
export function chooseInitialViewId<T extends { id: string; type: string }>(
  views: T[],
  options: {
    requestedId?: string | null;
    rememberedId?: string | null;
    hiddenIds?: string[];
  } = {},
): string {
  if (views.length === 0) return "";

  const hidden = new Set(options.hiddenIds ?? []);
  const visible = views.filter((view) => !hidden.has(view.id));

  const requested = views.find((view) => view.id === options.requestedId);
  if (requested) return requested.id;

  const remembered = visible.find((view) => view.id === options.rememberedId);
  if (remembered) return remembered.id;

  const table = visible.find((view) => view.type === "table");
  if (table) return table.id;

  return (visible[0] ?? views[0]).id;
}
