import { dateKey } from "./calendar";

/** How far ahead "due soon" looks. Overdue records are always included. */
export const DUE_SOON_DAYS = 7;

/** Stored as a task queue's status choice to keep every record, done or not. */
export const NO_STATUS_FILTER = "none";

export type QueueKind = "tasks" | "projects";

/**
 * A queue is a database plus the property that makes it useful: the due date
 * for tasks, the status for projects. An empty property id means "not chosen
 * yet" for tasks and "use the database's first status property" for projects.
 */
export type QueueConfig = {
  databaseId: string;
  propertyId: string;
  /**
   * Tasks only: the select property whose finished values drop a record from
   * the queue, or NO_STATUS_FILTER. Missing means "use the first one".
   */
  statusPropertyId?: string;
  /**
   * Projects only: the status values that leave the queue. Missing means the
   * built-in finished vocabulary decides.
   */
  excludedStatuses?: string[];
};

export type DashboardQueueConfig = {
  tasks: QueueConfig | null;
  projects: QueueConfig | null;
};

export type DueBucket = "overdue" | "today" | "soon";

const MAX_ID_LENGTH = 100;
const MAX_EXCLUDED_STATUSES = 24;
const MAX_STATUS_LENGTH = 100;

function parseExcludedStatuses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const statuses: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const status = entry.trim();
    if (!status || status.length > MAX_STATUS_LENGTH) continue;

    const key = status.toLocaleLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    statuses.push(status);
    if (statuses.length >= MAX_EXCLUDED_STATUSES) break;
  }

  return statuses;
}

/** Stored preferences are untrusted JSON, so parse them defensively. */
export function parseQueueConfig(value: unknown): QueueConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { databaseId, propertyId, statusPropertyId, excludedStatuses } =
    value as Partial<QueueConfig>;

  if (typeof databaseId !== "string" || !databaseId || databaseId.length > MAX_ID_LENGTH) {
    return null;
  }

  const config: QueueConfig = {
    databaseId,
    propertyId:
      typeof propertyId === "string" && propertyId.length <= MAX_ID_LENGTH ? propertyId : "",
  };
  // An automatic choice is stored as no field at all, so a config written
  // before this choice existed keeps reading as "first status property".
  if (
    typeof statusPropertyId === "string" &&
    statusPropertyId &&
    statusPropertyId.length <= MAX_ID_LENGTH
  ) {
    config.statusPropertyId = statusPropertyId;
  }
  const statuses = parseExcludedStatuses(excludedStatuses);
  if (statuses.length > 0) config.excludedStatuses = statuses;

  return config;
}

export function parseDashboardQueues(serialized: string | null): DashboardQueueConfig {
  const empty: DashboardQueueConfig = { tasks: null, projects: null };
  if (!serialized) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return empty;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
  const record = parsed as Record<string, unknown>;

  return {
    tasks: parseQueueConfig(record.tasks),
    projects: parseQueueConfig(record.projects),
  };
}

export function setQueueConfig(
  queues: DashboardQueueConfig,
  kind: QueueKind,
  config: QueueConfig | null,
): DashboardQueueConfig {
  const next = { ...queues };
  next[kind] = config ? parseQueueConfig(config) : null;
  return next;
}

/** Whole days from `today` to `due`; null when either value is not a date. */
export function daysUntil(due: unknown, today: unknown): number | null {
  const dueValue = dateKey(due);
  const todayValue = dateKey(today);
  if (!dueValue || !todayValue) return null;

  const difference =
    Date.parse(`${dueValue}T00:00:00Z`) - Date.parse(`${todayValue}T00:00:00Z`);
  return Math.round(difference / 86_400_000);
}

export function dueBucket(
  due: unknown,
  today: unknown,
  horizon = DUE_SOON_DAYS,
): DueBucket | null {
  const days = daysUntil(due, today);
  if (days === null) return null;
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return days <= horizon ? "soon" : null;
}

export function describeDue(due: unknown, today: unknown): string {
  const days = daysUntil(due, today);
  if (days === null) return "";
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days}d`;
}

const COMPLETED_STATUS =
  /^(done|complete|completed|finished|shipped|archived|dropped|abandoned|cancelled|canceled)$/i;

/**
 * Status words are free text, so both queues read the common finish spellings
 * instead of asking every database to adopt one vocabulary.
 */
export function isCompletedStatus(status: unknown): boolean {
  return typeof status === "string" && COMPLETED_STATUS.test(status.trim());
}

/** A chosen status value matches regardless of case or surrounding spaces. */
export function isExcludedStatus(status: unknown, excluded: readonly string[]): boolean {
  if (typeof status !== "string") return false;

  const value = status.trim().toLocaleLowerCase();
  if (!value) return false;

  return excluded.some((entry) => entry.trim().toLocaleLowerCase() === value);
}
