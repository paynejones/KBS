export type DashboardWidget = {
  viewId: string;
  databaseId: string;
};

export const DASHBOARD_WIDGET_LIMIT = 6;

const STORAGE_KEY = "kbs:dashboard-widgets";
export const DASHBOARD_UPDATED_EVENT = "kbs:dashboard-updated";

/**
 * Dashboard layout is a per-browser preference, like recents and the theme.
 * Malformed rows, duplicates, and entries beyond the limit are dropped.
 */
export function parseDashboardWidgets(serialized: string | null): DashboardWidget[] {
  if (!serialized) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const widgets: DashboardWidget[] = [];

  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { viewId, databaseId } = entry as Partial<DashboardWidget>;

    if (typeof viewId !== "string" || !viewId) continue;
    if (typeof databaseId !== "string" || !databaseId) continue;
    if (seen.has(viewId)) continue;

    seen.add(viewId);
    widgets.push({ viewId, databaseId });

    if (widgets.length >= DASHBOARD_WIDGET_LIMIT) break;
  }

  return widgets;
}

export function addWidget(
  widgets: DashboardWidget[],
  widget: DashboardWidget,
  limit = DASHBOARD_WIDGET_LIMIT,
): DashboardWidget[] {
  if (!widget.viewId || !widget.databaseId) return widgets.slice(0, limit);

  return [
    { viewId: widget.viewId, databaseId: widget.databaseId },
    ...widgets.filter((entry) => entry.viewId !== widget.viewId),
  ].slice(0, limit);
}

export function removeWidget(
  widgets: DashboardWidget[],
  viewId: string,
): DashboardWidget[] {
  return widgets.filter((entry) => entry.viewId !== viewId);
}

const EMPTY_WIDGETS: DashboardWidget[] = [];
let cachedRaw: string | null | undefined;
let cachedWidgets: DashboardWidget[] = EMPTY_WIDGETS;

export function getDashboardWidgetsSnapshot(): DashboardWidget[] {
  if (typeof window === "undefined") return EMPTY_WIDGETS;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY_WIDGETS;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedWidgets = parseDashboardWidgets(raw);
  }
  return cachedWidgets;
}

export function getEmptyDashboardWidgetsSnapshot(): DashboardWidget[] {
  return EMPTY_WIDGETS;
}

export function subscribeToDashboardWidgets(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DASHBOARD_UPDATED_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(DASHBOARD_UPDATED_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function storeDashboardWidgets(widgets: DashboardWidget[]): void {
  if (typeof window === "undefined") return;
  try {
    if (widgets.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
    window.dispatchEvent(new Event(DASHBOARD_UPDATED_EVENT));
  } catch {
    // A dashboard is a convenience; storage failures must not break the home page.
  }
}
