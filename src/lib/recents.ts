export type RecentPage = {
  id: string;
  title: string;
  visitedAt: number;
};

export const RECENT_PAGES_LIMIT = 8;

const STORAGE_KEY = "kbs:recent-pages";
export const RECENTS_UPDATED_EVENT = "kbs:recents-updated";

/**
 * Reads recent pages from storage defensively: malformed rows, duplicate IDs,
 * missing timestamps, and stale entries beyond the limit are dropped.
 */
export function parseRecentPages(serialized: string | null): RecentPage[] {
  if (!serialized) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const pages: RecentPage[] = [];

  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { id, title, visitedAt } = entry as Partial<RecentPage>;

    if (typeof id !== "string" || !id) continue;
    if (typeof title !== "string") continue;
    if (typeof visitedAt !== "number" || !Number.isFinite(visitedAt) || visitedAt <= 0) continue;
    if (seen.has(id)) continue;

    seen.add(id);
    pages.push({ id, title: title.trim().slice(0, 200) || "Untitled", visitedAt });

    if (pages.length >= RECENT_PAGES_LIMIT) break;
  }

  return pages;
}

export function addRecentPage(
  pages: RecentPage[],
  page: { id: string; title: string },
  visitedAt: number,
  limit = RECENT_PAGES_LIMIT,
): RecentPage[] {
  if (!page.id) return pages.slice(0, limit);

  const title = page.title.trim().slice(0, 200) || "Untitled";

  return [
    { id: page.id, title, visitedAt },
    ...pages.filter((entry) => entry.id !== page.id),
  ].slice(0, limit);
}

export function formatRecentTime(visitedAt: number, now = Date.now()): string {
  const difference = now - visitedAt;
  if (!Number.isFinite(difference) || difference < 60_000) return "just now";

  const minutes = Math.floor(difference / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(visitedAt).toLocaleDateString();
}

const EMPTY_RECENT_PAGES: RecentPage[] = [];
let cachedRaw: string | null | undefined;
let cachedPages: RecentPage[] = EMPTY_RECENT_PAGES;

/**
 * Snapshot for useSyncExternalStore. The parsed array keeps a stable identity
 * until storage changes so React does not loop on new references.
 */
export function getRecentPagesSnapshot(): RecentPage[] {
  if (typeof window === "undefined") return EMPTY_RECENT_PAGES;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY_RECENT_PAGES;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPages = parseRecentPages(raw);
  }
  return cachedPages;
}

export function getEmptyRecentPagesSnapshot(): RecentPage[] {
  return EMPTY_RECENT_PAGES;
}

export function subscribeToRecentPages(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(RECENTS_UPDATED_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(RECENTS_UPDATED_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function loadRecentPages(): RecentPage[] {
  return getRecentPagesSnapshot();
}

export function recordRecentPage(page: { id: string; title: string }): void {
  if (typeof window === "undefined") return;
  try {
    const next = addRecentPage(loadRecentPages(), page, Date.now());
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(RECENTS_UPDATED_EVENT));
  } catch {
    // Recent pages are a convenience; storage failures must not break editing.
  }
}

export function clearRecentPages(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(RECENTS_UPDATED_EVENT));
  } catch {
    // Ignore unavailable storage.
  }
}
