"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { todayKey } from "@/lib/calendar";
import {
  DUE_SOON_DAYS,
  describeDue,
  NO_STATUS_FILTER,
  setQueueConfig,
  type DueBucket,
} from "@/lib/dashboard-queues";
import {
  getDashboardQueuesSnapshot,
  getEmptyDashboardQueuesSnapshot,
  storeDashboardQueues,
  subscribeToDashboardQueues,
} from "@/lib/dashboard";
import type { DatabasePropertyType } from "@/lib/database-property";
import { statusToneClass } from "@/lib/status-tone";

type DashboardProperty = { id: string; name: string; type: DatabasePropertyType; choices?: string[] };
type DatabaseOption = { id: string; name: string; properties: DashboardProperty[] };

type TaskQueue = {
  databaseId: string;
  databaseName: string;
  property: { id: string; name: string };
  statusProperty: { id: string; name: string } | null;
  records: { id: string; title: string; due: string; bucket: DueBucket }[];
  total: number;
  overdue: number;
};

type ProjectQueue = {
  databaseId: string;
  databaseName: string;
  property: { id: string; name: string } | null;
  records: { id: string; title: string; status: string }[];
  total: number;
};

type DashboardData = {
  databases: DatabaseOption[];
  tasks: TaskQueue | null;
  projects: ProjectQueue | null;
};

const DUE_TONES: Record<DueBucket, string> = {
  overdue: "font-medium text-destructive",
  today: "font-medium text-brand",
  soon: "text-muted-foreground",
};

const SELECT_CLASS = "mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs";
const LABEL_CLASS = "block min-w-0 flex-1";
const LABEL_TEXT_CLASS = "text-[11px] font-medium text-muted-foreground";

/**
 * Two queues that make the home page a daily landing page: what needs doing
 * soon, and what is currently in flight. Both are views over existing database
 * records; the choice of database and property is remembered per browser like
 * the pinned-view layout.
 */
export function DashboardQueues() {
  const queues = useSyncExternalStore(
    subscribeToDashboardQueues,
    getDashboardQueuesSnapshot,
    getEmptyDashboardQueuesSnapshot,
  );
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  const taskConfig = queues.tasks;
  const projectConfig = queues.projects;
  const today = todayKey();
  const requestParams = [
    taskConfig ? `taskDatabaseId=${encodeURIComponent(taskConfig.databaseId)}` : "",
    taskConfig?.propertyId ? `taskPropertyId=${encodeURIComponent(taskConfig.propertyId)}` : "",
    taskConfig?.statusPropertyId
      ? `taskStatusPropertyId=${encodeURIComponent(taskConfig.statusPropertyId)}`
      : "",
    projectConfig ? `projectDatabaseId=${encodeURIComponent(projectConfig.databaseId)}` : "",
    projectConfig?.propertyId
      ? `projectPropertyId=${encodeURIComponent(projectConfig.propertyId)}`
      : "",
    ...(projectConfig?.excludedStatuses ?? []).map(
      (status) => `projectExcludedStatus=${encodeURIComponent(status)}`,
    ),
    `today=${today}`,
  ]
    .filter(Boolean)
    .join("&");

  useEffect(() => {
    let cancelled = false;

    async function loadQueues() {
      setLoading(true);
      setLoadError("");
      try {
        const response = await fetch(`/api/dashboard?${requestParams}`);
        if (!response.ok) throw new Error("Could not load your queues.");
        const payload: DashboardData = await response.json();
        if (!cancelled) setData(payload);
      } catch (loadFailure) {
        if (!cancelled) {
          setLoadError(
            loadFailure instanceof Error
              ? loadFailure.message
              : "Could not load your queues.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadQueues();
    return () => {
      cancelled = true;
    };
  }, [requestParams, retryKey]);

  const databases = data?.databases ?? [];
  const taskQueue = data?.tasks ?? null;
  const projectQueue = data?.projects ?? null;
  const taskDatabase = taskConfig
    ? databases.find((database) => database.id === taskConfig.databaseId)
    : undefined;
  const projectDatabase = projectConfig
    ? databases.find((database) => database.id === projectConfig.databaseId)
    : undefined;
  const taskProperties =
    taskDatabase?.properties.filter((property) => property.type === "date") ?? [];
  const taskStatusProperties =
    taskDatabase?.properties.filter((property) => property.type === "select") ?? [];
  const projectProperties =
    projectDatabase?.properties.filter((property) => property.type === "select") ?? [];
  const projectStatusProperty =
    projectProperties.find((property) => property.id === projectConfig?.propertyId) ??
    projectProperties[0];
  const projectExcludedStatuses = projectConfig?.excludedStatuses ?? [];
  // Offer every choice, plus any status already chosen but since removed from
  // the property, so a stale choice can still be switched off.
  const projectStatusChoices = Array.from(
    new Set([...(projectStatusProperty?.choices ?? []), ...projectExcludedStatuses]),
  );

  function selectTaskDatabase(databaseId: string) {
    storeDashboardQueues(
      setQueueConfig(queues, "tasks", databaseId ? { databaseId, propertyId: "" } : null),
    );
  }

  function selectTaskProperty(propertyId: string) {
    if (!taskConfig) return;
    storeDashboardQueues(
      setQueueConfig(queues, "tasks", {
        databaseId: taskConfig.databaseId,
        propertyId,
        statusPropertyId: taskConfig.statusPropertyId,
      }),
    );
  }

  function selectTaskStatus(statusPropertyId: string) {
    if (!taskConfig) return;
    storeDashboardQueues(
      setQueueConfig(queues, "tasks", {
        databaseId: taskConfig.databaseId,
        propertyId: taskConfig.propertyId,
        statusPropertyId,
      }),
    );
  }

  function selectProjectDatabase(databaseId: string) {
    storeDashboardQueues(
      setQueueConfig(queues, "projects", databaseId ? { databaseId, propertyId: "" } : null),
    );
  }

  function selectProjectProperty(propertyId: string) {
    if (!projectConfig) return;
    storeDashboardQueues(
      setQueueConfig(queues, "projects", {
        databaseId: projectConfig.databaseId,
        propertyId,
        excludedStatuses: projectConfig.excludedStatuses,
      }),
    );
  }

  function toggleProjectStatus(status: string) {
    if (!projectConfig) return;
    const current = projectConfig.excludedStatuses ?? [];
    const chosen = current.some(
      (entry) => entry.toLocaleLowerCase() === status.toLocaleLowerCase(),
    );
    storeDashboardQueues(
      setQueueConfig(queues, "projects", {
        databaseId: projectConfig.databaseId,
        propertyId: projectConfig.propertyId,
        excludedStatuses: chosen
          ? current.filter(
              (entry) => entry.toLocaleLowerCase() !== status.toLocaleLowerCase(),
            )
          : [...current, status],
      }),
    );
  }

  const taskList = taskQueue ? (
    taskQueue.records.length === 0 ? (
      <p className="mt-3 text-xs text-muted-foreground">
        Nothing due in the next {DUE_SOON_DAYS} days.
      </p>
    ) : (
      <>
        <ul className="mt-2">
          {taskQueue.records.map((record) => (
            <li
              key={record.id}
              className="flex min-w-0 items-center gap-2 border-b py-1.5 last:border-b-0"
            >
              <Link
                href={`/databases/${taskQueue.databaseId}/records/${record.id}`}
                className="min-w-0 flex-1 truncate text-xs font-medium transition-colors hover:text-brand hover:underline"
              >
                {record.title || "Untitled"}
              </Link>
              <span
                className={`shrink-0 text-[11px] tabular-nums ${DUE_TONES[record.bucket]}`}
                title={`Due ${record.due}`}
              >
                {describeDue(record.due, today)}
              </span>
            </li>
          ))}
        </ul>
        <Link
          href={`/databases/${taskQueue.databaseId}`}
          className="mt-2 inline-flex items-center gap-1 border-t pt-2 text-[11px] font-medium text-brand hover:underline"
        >
          View all {taskQueue.total} due
          <ArrowRight size={11} aria-hidden="true" />
        </Link>
      </>
    )
  ) : null;

  const projectList = projectQueue ? (
    projectQueue.records.length === 0 ? (
      <p className="mt-3 text-xs text-muted-foreground">No active projects.</p>
    ) : (
      <>
        <ul className="mt-2">
          {projectQueue.records.map((record) => (
            <li
              key={record.id}
              className="flex min-w-0 items-center gap-2 border-b py-1.5 last:border-b-0"
            >
              <Link
                href={`/databases/${projectQueue.databaseId}/records/${record.id}`}
                className="min-w-0 flex-1 truncate text-xs font-medium transition-colors hover:text-brand hover:underline"
              >
                {record.title || "Untitled"}
              </Link>
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusToneClass(record.status)}`}
              >
                <span className="size-1 rounded-full bg-current" />
                {record.status || "No status"}
              </span>
            </li>
          ))}
        </ul>
        <Link
          href={`/databases/${projectQueue.databaseId}`}
          className="mt-2 inline-flex items-center gap-1 border-t pt-2 text-[11px] font-medium text-brand hover:underline"
        >
          View all {projectQueue.total} projects
          <ArrowRight size={11} aria-hidden="true" />
        </Link>
      </>
    )
  ) : null;

  return (
    <section aria-label="Today" className="grid gap-3 sm:grid-cols-2">
      {loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-card p-4 sm:col-span-2"
        >
          <p className="text-sm text-destructive">{loadError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRetryKey((current) => current + 1)}
          >
            Try again
          </Button>
        </div>
      )}

      <article className="flex flex-col rounded-xl border bg-card p-4">
        <div className="flex items-start gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
            <CalendarClock size={13} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold tracking-tight">
              Due soon
              {taskQueue && taskQueue.overdue > 0 && (
                <span
                  className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusToneClass("overdue")}`}
                >
                  {taskQueue.overdue} overdue
                </span>
              )}
            </h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {taskQueue
                ? `${taskQueue.databaseName} · ${taskQueue.property.name}`
                : `Overdue and the next ${DUE_SOON_DAYS} days`}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <label className={LABEL_CLASS}>
            <span className={LABEL_TEXT_CLASS}>Task database</span>
            <select
              aria-label="Task database"
              value={taskConfig?.databaseId ?? ""}
              onChange={(event) => selectTaskDatabase(event.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Choose a database…</option>
              {databases.map((database) => (
                <option key={database.id} value={database.id}>
                  {database.name}
                </option>
              ))}
            </select>
          </label>

          {taskConfig && (
            <label className={LABEL_CLASS}>
              <span className={LABEL_TEXT_CLASS}>Due date property</span>
              <select
                aria-label="Due date property"
                value={taskConfig.propertyId}
                onChange={(event) => selectTaskProperty(event.target.value)}
                disabled={taskProperties.length === 0}
                className={SELECT_CLASS}
              >
                <option value="">
                  {taskProperties.length === 0 ? "No date property" : "Choose a date…"}
                </option>
                {taskProperties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {taskConfig && (
            <label className={LABEL_CLASS}>
              <span className={LABEL_TEXT_CLASS}>Done status</span>
              <select
                aria-label="Done status"
                value={taskConfig.statusPropertyId ?? ""}
                onChange={(event) => selectTaskStatus(event.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">First status property</option>
                {taskStatusProperties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
                <option value={NO_STATUS_FILTER}>No status filter</option>
              </select>
            </label>
          )}
        </div>

        {loadError ? null : loading && !data ? (
          <div role="status" aria-label="Loading due soon" className="mt-3 space-y-1.5">
            <div className="h-5 animate-pulse rounded bg-muted" />
            <div className="h-5 animate-pulse rounded bg-muted" />
          </div>
        ) : !taskConfig ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {databases.length === 0
              ? "Create a database with a date property to track what is due."
              : "Pick a database whose date property holds due dates."}
          </p>
        ) : !taskConfig.propertyId ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {taskProperties.length === 0
              ? "This database has no date property yet."
              : "Choose a date property to see what is due."}
          </p>
        ) : taskQueue ? (
          taskList
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            This due-date source is no longer available. Choose another database.
          </p>
        )}
      </article>

      <article className="flex flex-col rounded-xl border bg-card p-4">
        <div className="flex items-start gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
            <FolderKanban size={13} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold tracking-tight">Current projects</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {projectQueue
                ? `${projectQueue.databaseName}${projectQueue.property ? ` · ${projectQueue.property.name}` : ""}`
                : "Records whose status is not done"}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <label className={LABEL_CLASS}>
            <span className={LABEL_TEXT_CLASS}>Project database</span>
            <select
              aria-label="Project database"
              value={projectConfig?.databaseId ?? ""}
              onChange={(event) => selectProjectDatabase(event.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Choose a database…</option>
              {databases.map((database) => (
                <option key={database.id} value={database.id}>
                  {database.name}
                </option>
              ))}
            </select>
          </label>

          {projectConfig && (
            <label className={LABEL_CLASS}>
              <span className={LABEL_TEXT_CLASS}>Status property</span>
              <select
                aria-label="Status property"
                value={projectConfig.propertyId}
                onChange={(event) => selectProjectProperty(event.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">First status property</option>
                {projectProperties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {projectConfig && projectStatusChoices.length > 0 && (
          <div className="mt-2">
            <p className={LABEL_TEXT_CLASS}>Finished statuses</p>
            <div
              role="group"
              aria-label="Finished statuses"
              className="mt-1 flex flex-wrap gap-1"
            >
              {projectStatusChoices.map((status) => {
                const pressed = projectExcludedStatuses.some(
                  (entry) => entry.toLocaleLowerCase() === status.toLocaleLowerCase(),
                );
                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => toggleProjectStatus(status)}
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                      pressed
                        ? "border-transparent bg-brand-soft text-brand"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {status}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {projectExcludedStatuses.length === 0
                ? "Nothing chosen yet, so done, finished, and archived are skipped."
                : "Only the chosen statuses leave the queue."}
            </p>
          </div>
        )}

        {loadError ? null : loading && !data ? (
          <div role="status" aria-label="Loading current projects" className="mt-3 space-y-1.5">
            <div className="h-5 animate-pulse rounded bg-muted" />
            <div className="h-5 animate-pulse rounded bg-muted" />
          </div>
        ) : !projectConfig ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {databases.length === 0
              ? "Create a database with a status property to follow active work."
              : "Pick a database whose status property tracks project progress."}
          </p>
        ) : projectQueue ? (
          projectList
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            This project source is no longer available. Choose another database.
          </p>
        )}
      </article>
    </section>
  );
}
