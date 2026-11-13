export type DashboardWidgetId =
  | "resume"
  | "queues"
  | "pinned-projects"
  | "timeline"
  | "recent"
  | "views"
  | "favorites"
  | "reading"
  | "inbox"
  | "saved-searches"
  | "databases";

export type DashboardWidgetSpan = "full" | "half";

export type DashboardWidgetDefinition = {
  id: DashboardWidgetId;
  label: string;
  /** The width a widget uses until the user picks another one. */
  span: DashboardWidgetSpan;
};

/**
 * The widgets the home page can draw. Adding one here makes it available to the
 * layout, the hidden list, and the customize UI; the page supplies its content.
 */
export const DASHBOARD_WIDGETS: DashboardWidgetDefinition[] = [
  { id: "resume", label: "Pick up where you left off", span: "full" },
  { id: "queues", label: "Today", span: "full" },
  { id: "pinned-projects", label: "Pinned projects", span: "full" },
  { id: "timeline", label: "Timeline", span: "full" },
  { id: "recent", label: "Jump back in", span: "half" },
  { id: "views", label: "Pinned views", span: "half" },
  { id: "favorites", label: "Favorites", span: "half" },
  { id: "reading", label: "Reading list", span: "half" },
  { id: "inbox", label: "Inbox", span: "full" },
  { id: "saved-searches", label: "Saved searches", span: "half" },
  { id: "databases", label: "Databases", span: "half" },
];

export const DASHBOARD_WIDGET_IDS: DashboardWidgetId[] = DASHBOARD_WIDGETS.map(
  (widget) => widget.id,
);

export const DASHBOARD_LAYOUT_STORAGE_KEY = "kbs:dashboard-layout";
export const DASHBOARD_LAYOUT_UPDATED_EVENT = "kbs:dashboard-layout-updated";

export type DashboardLayout = {
  order: DashboardWidgetId[];
  hidden: DashboardWidgetId[];
  /** Width overrides; a missing entry uses the widget's default span. */
  sizes: Partial<Record<DashboardWidgetId, DashboardWidgetSpan>>;
  /** A locked layout hides every editing control until it is unlocked. */
  locked: boolean;
};

export function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return (
    typeof value === "string" &&
    (DASHBOARD_WIDGET_IDS as string[]).includes(value)
  );
}

export function dashboardWidget(
  id: DashboardWidgetId,
): DashboardWidgetDefinition {
  return DASHBOARD_WIDGETS.find((widget) => widget.id === id)!;
}

export function defaultDashboardLayout(): DashboardLayout {
  return { order: [...DASHBOARD_WIDGET_IDS], hidden: [], sizes: {}, locked: false };
}

function uniqueWidgetIds(value: unknown): DashboardWidgetId[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<DashboardWidgetId>();
  for (const entry of value) {
    if (isDashboardWidgetId(entry) && !seen.has(entry)) seen.add(entry);
  }
  return [...seen];
}

/**
 * A saved layout may predate a widget, carry an unknown id, or repeat entries.
 * Known ids keep their saved order, unknown and duplicate entries are dropped,
 * and any widget missing from the order is appended in its default position.
 */
export function normalizeDashboardLayout(value: unknown): DashboardLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultDashboardLayout();
  }

  const candidate = value as Partial<DashboardLayout>;
  const order = uniqueWidgetIds(candidate.order);
  for (const id of DASHBOARD_WIDGET_IDS) {
    if (!order.includes(id)) order.push(id);
  }

  return {
    order,
    hidden: uniqueWidgetIds(candidate.hidden),
    sizes: normalizeWidgetSizes(candidate.sizes),
    locked: candidate.locked === true,
  };
}

function normalizeWidgetSizes(
  value: unknown,
): Partial<Record<DashboardWidgetId, DashboardWidgetSpan>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const sizes: Partial<Record<DashboardWidgetId, DashboardWidgetSpan>> = {};
  for (const [id, span] of Object.entries(value)) {
    if (isDashboardWidgetId(id) && (span === "full" || span === "half")) {
      sizes[id] = span;
    }
  }
  return sizes;
}

/** The width to draw a widget at, honouring a saved override. */
export function dashboardWidgetSpan(
  layout: DashboardLayout,
  id: DashboardWidgetId,
): DashboardWidgetSpan {
  return layout.sizes[id] ?? dashboardWidget(id).span;
}

/** Picking the default width again drops the override instead of storing it. */
export function setDashboardWidgetSize(
  layout: DashboardLayout,
  id: DashboardWidgetId,
  span: DashboardWidgetSpan,
): DashboardLayout {
  const sizes = { ...layout.sizes };
  if (dashboardWidget(id).span === span) delete sizes[id];
  else sizes[id] = span;
  return { ...layout, sizes };
}

/** Locks or unlocks editing; the arrangement itself is left untouched. */
export function setDashboardLocked(
  layout: DashboardLayout,
  locked: boolean,
): DashboardLayout {
  return { ...layout, locked };
}

export function parseDashboardLayout(serialized: string | null): DashboardLayout {
  if (!serialized) return defaultDashboardLayout();

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return defaultDashboardLayout();
  }

  return normalizeDashboardLayout(parsed);
}

/** Swaps a widget with its neighbour, ignoring moves past either end. */
export function moveDashboardWidget(
  layout: DashboardLayout,
  id: DashboardWidgetId,
  direction: "up" | "down",
): DashboardLayout {
  const index = layout.order.indexOf(id);
  if (index === -1) return layout;

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= layout.order.length) return layout;

  const order = [...layout.order];
  [order[index], order[target]] = [order[target], order[index]];
  return { ...layout, order };
}

/**
 * Moves a dragged widget in front of `beforeId`; a null target appends it to the
 * end. Dropping a widget on itself is a no-op.
 */
export function reorderDashboardWidget(
  layout: DashboardLayout,
  id: DashboardWidgetId,
  beforeId: DashboardWidgetId | null,
): DashboardLayout {
  if (id === beforeId) return layout;

  const order = layout.order.filter((entry) => entry !== id);
  const index = beforeId === null ? order.length : order.indexOf(beforeId);
  order.splice(index === -1 ? order.length : index, 0, id);
  return { ...layout, order };
}

export function setDashboardWidgetHidden(
  layout: DashboardLayout,
  id: DashboardWidgetId,
  hidden: boolean,
): DashboardLayout {
  const current = layout.hidden.filter((entry) => entry !== id);
  return {
    ...layout,
    hidden: hidden ? [...current, id] : current,
  };
}

const DEFAULT_LAYOUT = defaultDashboardLayout();

let cachedRaw: string | null | undefined;
let cachedLayout: DashboardLayout = DEFAULT_LAYOUT;

export function getDashboardLayoutSnapshot(): DashboardLayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
  } catch {
    return DEFAULT_LAYOUT;
  }

  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedLayout = parseDashboardLayout(raw);
  }
  return cachedLayout;
}

export function getServerDashboardLayoutSnapshot(): DashboardLayout {
  return DEFAULT_LAYOUT;
}

export function subscribeToDashboardLayout(onChange: () => void) {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("storage", onChange);
  window.addEventListener(DASHBOARD_LAYOUT_UPDATED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DASHBOARD_LAYOUT_UPDATED_EVENT, onChange);
  };
}

export function storeDashboardLayout(layout: DashboardLayout): void {
  if (typeof window === "undefined") return;

  const normalized = normalizeDashboardLayout(layout);
  const serialized = JSON.stringify(normalized);
  try {
    if (serialized === JSON.stringify(DEFAULT_LAYOUT)) {
      window.localStorage.removeItem(DASHBOARD_LAYOUT_STORAGE_KEY);
      cachedRaw = null;
    } else {
      window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, serialized);
      cachedRaw = serialized;
    }
    cachedLayout = normalized;
  } catch {
    // The home page falls back to the default layout when storage is unavailable.
  }

  window.dispatchEvent(new Event(DASHBOARD_LAYOUT_UPDATED_EVENT));
}
