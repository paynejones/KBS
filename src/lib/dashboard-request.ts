import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * The home page's widgets each know one slice of the dashboard query: the
 * queues know their database and properties, the timeline knows its horizon,
 * and the pinned views know which views to preview. They register that slice
 * here and this store merges it into a single `/api/dashboard` request, which
 * the route scopes to exactly the databases the merged query names.
 *
 * Sharing one request is what makes that scope possible: three separate calls
 * would each have to guess at the other widgets' needs to fill the page.
 */
export type DashboardRequest = {
  today?: string;
  viewIds?: string[];
  taskDatabaseId?: string;
  taskPropertyId?: string;
  taskStatusPropertyId?: string;
  projectDatabaseId?: string;
  projectPropertyId?: string;
  projectExcludedStatuses?: string[];
  timeline?: boolean;
  timelineDays?: string;
};

export type DashboardSnapshot = {
  /** The last successful payload, kept on screen while a newer one loads. */
  data: unknown;
  loading: boolean;
  failed: boolean;
};

const initialSnapshot: DashboardSnapshot = {
  data: null,
  loading: true,
  failed: false,
};

const requests = new Map<string, DashboardRequest>();
const listeners = new Set<() => void>();

let snapshot = initialSnapshot;
let currentQuery: string | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let version = 0;
let waiters: (() => void)[] = [];

function publish(next: DashboardSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function getDashboardSnapshot(): DashboardSnapshot {
  return snapshot;
}

export function getServerDashboardSnapshot(): DashboardSnapshot {
  return initialSnapshot;
}

export function subscribeToDashboard(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Every mounted widget's slice, merged into one query. Lists are unioned so two
 * widgets never ask for the same view or status twice, and the singular
 * settings each belong to one widget type today.
 */
export function mergeDashboardRequest(): string {
  const viewIds = new Set<string>();
  const excludedStatuses = new Set<string>();
  let today = "";
  let taskDatabaseId = "";
  let taskPropertyId = "";
  let taskStatusPropertyId = "";
  let projectDatabaseId = "";
  let projectPropertyId = "";
  let timelineDays = "";
  let timeline = false;

  for (const request of requests.values()) {
    for (const id of request.viewIds ?? []) viewIds.add(id);
    for (const status of request.projectExcludedStatuses ?? []) excludedStatuses.add(status);
    if (!today && request.today) today = request.today;
    if (!taskDatabaseId && request.taskDatabaseId) taskDatabaseId = request.taskDatabaseId;
    if (!taskPropertyId && request.taskPropertyId) taskPropertyId = request.taskPropertyId;
    if (!taskStatusPropertyId && request.taskStatusPropertyId) {
      taskStatusPropertyId = request.taskStatusPropertyId;
    }
    if (!projectDatabaseId && request.projectDatabaseId) projectDatabaseId = request.projectDatabaseId;
    if (!projectPropertyId && request.projectPropertyId) projectPropertyId = request.projectPropertyId;
    if (!timelineDays && request.timelineDays) timelineDays = request.timelineDays;
    if (request.timeline) timeline = true;
  }

  const params = new URLSearchParams();
  if (viewIds.size > 0) params.set("viewIds", [...viewIds].sort().join(","));
  if (today) params.set("today", today);
  if (taskDatabaseId) params.set("taskDatabaseId", taskDatabaseId);
  if (taskPropertyId) params.set("taskPropertyId", taskPropertyId);
  if (taskStatusPropertyId) params.set("taskStatusPropertyId", taskStatusPropertyId);
  if (projectDatabaseId) params.set("projectDatabaseId", projectDatabaseId);
  if (projectPropertyId) params.set("projectPropertyId", projectPropertyId);
  if (timeline) {
    params.set("timeline", "1");
    if (timelineDays) params.set("timelineDays", timelineDays);
  }
  for (const status of [...excludedStatuses].sort()) {
    params.append("projectExcludedStatus", status);
  }

  return params.toString();
}

async function load(query: string) {
  const requestVersion = ++version;
  publish({ data: snapshot.data, loading: true, failed: false });

  let next: DashboardSnapshot;
  try {
    const response = await fetch(`/api/dashboard?${query}`);
    if (!response.ok) throw new Error("The dashboard request failed.");
    next = { data: await response.json(), loading: false, failed: false };
  } catch {
    next = { data: snapshot.data, loading: false, failed: true };
  }

  // A newer request started while this one was in flight, so its answer is the
  // one the page is waiting for.
  if (requestVersion !== version) return;

  currentQuery = query;
  publish(next);

  const settled = waiters;
  waiters = [];
  for (const resolve of settled) resolve();
}

/**
 * The last widget left. The cached query is forgotten so the next mount asks
 * again, and a response still in flight is ignored rather than applied to a
 * page that no longer shows it.
 */
function detach() {
  version += 1;
  currentQuery = null;
  const settled = waiters;
  waiters = [];
  for (const resolve of settled) resolve();
}

function scheduleFetch() {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  if (requests.size === 0) return;

  const query = mergeDashboardRequest();
  if (query === currentQuery && snapshot.data) return;

  // Let every widget mounted in this commit register before the first request,
  // so the page asks once for the union instead of once per widget.
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    void load(mergeDashboardRequest());
  }, 0);
}

export function registerDashboardRequest(
  id: string,
  request: DashboardRequest,
): () => void {
  requests.set(id, request);
  scheduleFetch();

  return () => {
    requests.delete(id);
    if (requests.size === 0) {
      detach();
      return;
    }
    scheduleFetch();
  };
}

/** Re-runs the merged request, for a widget's "Try again" control. */
export function refreshDashboard(): Promise<void> {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  if (requests.size === 0) return Promise.resolve();

  const settled = new Promise<void>((resolve) => waiters.push(resolve));
  void load(mergeDashboardRequest());
  return settled;
}

function dashboardRequestKey(request: DashboardRequest): string {
  return JSON.stringify([
    request.today ?? "",
    [...(request.viewIds ?? [])].sort(),
    request.taskDatabaseId ?? "",
    request.taskPropertyId ?? "",
    request.taskStatusPropertyId ?? "",
    request.projectDatabaseId ?? "",
    request.projectPropertyId ?? "",
    [...(request.projectExcludedStatuses ?? [])].sort(),
    request.timeline ?? false,
    request.timelineDays ?? "",
  ]);
}

export function useDashboardRequest(
  id: string,
  request: DashboardRequest,
): DashboardSnapshot {
  const requestKey = dashboardRequestKey(request);
  // Registration only has to happen when the request's content changes, not on
  // every render, so the newest request is kept in a ref that an effect fills
  // in before the registering effect runs.
  const latest = useRef(request);

  useEffect(() => {
    latest.current = request;
  });

  useEffect(
    () => registerDashboardRequest(id, latest.current),
    [id, requestKey],
  );

  return useSyncExternalStore(
    subscribeToDashboard,
    getDashboardSnapshot,
    getServerDashboardSnapshot,
  );
}
