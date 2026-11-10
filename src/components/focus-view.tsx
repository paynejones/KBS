"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, Files, Link2, ListChecks, Star, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FOCUS_RECENTS_KEY,
  focusShortcuts,
  focusTaskProgress,
  parseFocusRecentIds,
  rememberFocusProject,
  type FocusData,
  type FocusTask,
} from "@/lib/focus";
import { saveTaskChecked } from "@/lib/focus-task-save";

type PageOption = { id: string; title: string; isFavorite: boolean; parentId: string | null };

const SELECTION_PARAM = "page";

function persistFocusRecents(ids: string[]) {
  try {
    window.localStorage.setItem(FOCUS_RECENTS_KEY, JSON.stringify(ids));
  } catch {
    // A blocked storage area only costs the quick-switch order.
  }
}

function withTaskChecked(data: FocusData, task: FocusTask, checked: boolean): FocusData {
  const tasks = data.tasks.map((entry) =>
    entry.pageId === task.pageId && entry.path.join(".") === task.path.join(".")
      ? { ...entry, checked }
      : entry,
  );
  return { ...data, tasks, progress: focusTaskProgress(tasks) };
}

/**
 * One project at a time: its task lists from the page and its subpages, the
 * subpages themselves, and the pages and records connected to it. Checking a
 * task writes to the page that holds the list, so the focus view never becomes
 * a second copy of the work.
 */
export function FocusView() {
  const [options, setOptions] = useState<PageOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [data, setData] = useState<FocusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [taskError, setTaskError] = useState("");
  const [savingTask, setSavingTask] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const selectId = useId();

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      try {
        const response = await fetch("/api/pages");
        if (!response.ok) throw new Error("Could not load pages.");
        const rows = (await response.json()) as PageOption[];
        if (cancelled) return;

        setOptions(rows);

        let storedRaw: string | null = null;
        try {
          storedRaw = window.localStorage.getItem(FOCUS_RECENTS_KEY);
        } catch {
          // Keep the workspace usable when storage is blocked.
        }
        const stored = parseFocusRecentIds(storedRaw);
        setRecentIds(stored);

        // A project link can name its page directly, but a page that has since
        // been deleted or trashed is not a valid selection.
        const requested = new URLSearchParams(window.location.search).get(SELECTION_PARAM);
        const selected = rows.some((row) => row.id === requested) ? requested! : "";
        if (selected) {
          // Opening a project link counts as focusing it, so it joins the row.
          const next = rememberFocusProject(stored, selected);
          setRecentIds(next);
          persistFocusRecents(next);
        }
        setSelectedId(selected);
      } catch {
        if (!cancelled) setLoadError("Could not load pages. Try again.");
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    }

    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const response = await fetch(`/api/pages/${selectedId}/focus`);
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!response.ok) throw new Error(payload?.error ?? "Could not load this project.");
        if (!cancelled) setData(payload as unknown as FocusData);
      } catch (error) {
        if (!cancelled) {
          setData(null);
          setLoadError(
            error instanceof Error ? error.message : "Could not load this project.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedId, retryKey]);

  function chooseProject(id: string) {
    setSelectedId(id);
    setTaskError("");
    setPinError("");
    setLoadError("");
    if (!id) {
      setData(null);
      setLoading(false);
    } else {
      const next = rememberFocusProject(recentIds, id);
      setRecentIds(next);
      persistFocusRecents(next);
    }

    const url = new URL(window.location.href);
    if (id) url.searchParams.set(SELECTION_PARAM, id);
    else url.searchParams.delete(SELECTION_PARAM);
    window.history.replaceState(null, "", url);
  }

  const toggleTask = useCallback(async (task: FocusTask) => {
    const key = `${task.pageId}:${task.path.join(".")}`;
    const nextChecked = !task.checked;

    // The checkbox answers immediately; a failed save puts it back.
    setSavingTask(key);
    setTaskError("");
    setData((current) => (current ? withTaskChecked(current, task, nextChecked) : current));

    try {
      // The task's own page is the source of truth, so the save reads it back
      // before writing in case the document changed since this view loaded.
      await saveTaskChecked(task, nextChecked);
      window.dispatchEvent(new Event("pages-updated"));
    } catch (error) {
      setData((current) => (current ? withTaskChecked(current, task, task.checked) : current));
      setTaskError(
        error instanceof Error ? error.message : "Could not save that task.",
      );
    } finally {
      setSavingTask("");
    }
  }, []);

  async function togglePinned() {
    if (!data || pinning) return;
    const next = !data.project.isFavorite;

    setPinning(true);
    setPinError("");
    try {
      const response = await fetch(`/api/pages/${data.project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavorite: next }),
      });
      if (!response.ok) throw new Error("Could not update this pin.");

      setData((current) =>
        current
          ? { ...current, project: { ...current.project, isFavorite: next } }
          : current,
      );
      setOptions((current) =>
        current.map((option) =>
          option.id === data.project.id ? { ...option, isFavorite: next } : option,
        ),
      );
      window.dispatchEvent(new Event("pages-updated"));
    } catch (error) {
      setPinError(error instanceof Error ? error.message : "Could not update this pin.");
    } finally {
      setPinning(false);
    }
  }

  const optionById = new Map(options.map((option) => [option.id, option]));
  const shortcuts = focusShortcuts(
    options.filter((option) => option.isFavorite).map((option) => option.id),
    recentIds,
  )
    .map((id) => optionById.get(id))
    .filter((option): option is PageOption => Boolean(option));

  const referenceCount = data
    ? data.references.links.length +
      data.references.backlinks.length +
      data.references.records.length
    : 0;

  return (
    <section className="mx-auto w-full max-w-4xl space-y-6">
      <header>
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <Target size={14} aria-hidden="true" />
          Focus
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          One project, everything it needs
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a project page to see its task lists, its subpages, and the pages and
          records connected to it. Checking a task saves back to the page that holds it.
        </p>
      </header>

      <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 sm:flex-row sm:items-end">
        <label htmlFor={selectId} className="grid flex-1 gap-1 text-xs text-muted-foreground">
          Project
          <select
            id={selectId}
            value={selectedId}
            onChange={(event) => chooseProject(event.target.value)}
            disabled={optionsLoading || options.length === 0}
            className="rounded-md border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="">
              {optionsLoading ? "Loading pages…" : "Choose a page…"}
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title || "Untitled"}
              </option>
            ))}
          </select>
        </label>
        {selectedId && (
          <Button type="button" variant="outline" size="sm" onClick={() => chooseProject("")}>
            Clear
          </Button>
        )}
      </div>

      {shortcuts.length > 0 && (
        <div
          role="group"
          aria-label="Pinned and recent projects"
          className="flex flex-wrap items-center gap-1.5"
        >
          <span className="text-xs text-muted-foreground">Quick switch</span>
          {shortcuts.map((project) => (
            <button
              key={project.id}
              type="button"
              aria-pressed={selectedId === project.id}
              onClick={() => chooseProject(project.id)}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                selectedId === project.id
                  ? "border-brand/40 bg-brand-soft font-medium text-brand-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {project.isFavorite && (
                <Star size={11} aria-hidden="true" className="shrink-0 fill-current" />
              )}
              <span className="truncate">{project.title || "Untitled"}</span>
            </button>
          ))}
        </div>
      )}

      {loadError && !data ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4"
        >
          <p className="text-sm text-destructive">{loadError}</p>
          {selectedId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRetryKey((current) => current + 1)}
            >
              Try again
            </Button>
          )}
        </div>
      ) : !optionsLoading && options.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">No pages to focus on yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a project page, add a task list, and its work will show up here.
          </p>
          <Link
            href="/pages"
            className="mt-3 inline-flex text-sm font-medium text-brand hover:underline"
          >
            Go to Pages
          </Link>
        </div>
      ) : !selectedId ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <Target className="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">Choose a project</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Any page can be a project. Its task lists and connected pages come along.
          </p>
        </div>
      ) : loading ? (
        <div
          role="status"
          className="animate-pulse rounded-xl border p-8 text-sm text-muted-foreground"
        >
          Gathering this project…
        </div>
      ) : data ? (
        <div className="space-y-4">
          <section aria-labelledby="focus-project" className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Project
                </p>
                <h2
                  id="focus-project"
                  className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"
                >
                  {data.project.icon && <span aria-hidden="true">{data.project.icon}</span>}
                  <span className="truncate">{data.project.title || "Untitled"}</span>
                </h2>
                {data.project.parent && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Part of{" "}
                    <Link
                      href={`/pages/${data.project.parent.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {data.project.parent.title || "Untitled"}
                    </Link>
                  </p>
                )}
                {data.project.tags.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Project tags">
                    {data.project.tags.map((tag) => (
                      <li
                        key={tag.id}
                        className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        #{tag.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={data.project.isFavorite}
                  onClick={() => void togglePinned()}
                  disabled={pinning}
                >
                  <Star
                    size={14}
                    aria-hidden="true"
                    className={data.project.isFavorite ? "fill-current" : undefined}
                  />
                  {data.project.isFavorite ? "Pinned" : "Pin project"}
                </Button>
                <Link
                  href={`/pages/${data.project.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  Open project
                  <ExternalLink size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
            {pinError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {pinError}
              </p>
            )}
          </section>

          <section aria-labelledby="focus-tasks" className="space-y-3 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="focus-tasks" className="flex items-center gap-2 font-medium">
                <ListChecks size={16} className="text-muted-foreground" aria-hidden="true" />
                Tasks
              </h2>
              <p className="text-sm text-muted-foreground">
                {data.progress.total === 0
                  ? "No tasks yet"
                  : `${data.progress.done} of ${data.progress.total} tasks done`}
              </p>
            </div>

            {data.progress.total > 0 && (
              <div
                role="progressbar"
                aria-label="Task progress"
                aria-valuemin={0}
                aria-valuemax={data.progress.total}
                aria-valuenow={data.progress.done}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-brand transition-[width]"
                  style={{ width: `${data.progress.percent}%` }}
                />
              </div>
            )}

            {data.tasks.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No task lists in this project yet. Add one on the project&apos;s page or a
                subpage and it will appear here.
              </p>
            ) : (
              <ul className="divide-y">
                {data.tasks.map((task) => {
                  const key = `${task.pageId}:${task.path.join(".")}`;
                  return (
                    <li key={key} className="flex items-start gap-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Complete ${task.text}`}
                        checked={task.checked}
                        disabled={savingTask === key}
                        onChange={() => void toggleTask(task)}
                        className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={`break-words text-sm ${
                            task.checked ? "text-muted-foreground line-through" : ""
                          }`}
                        >
                          {task.text}
                        </p>
                        {task.pageId !== data.project.id && (
                          <Link
                            href={`/pages/${task.pageId}`}
                            className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {task.pageTitle || "Untitled"}
                            <ArrowUpRight size={11} aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {taskError && (
              <p role="alert" className="text-sm text-destructive">
                {taskError}
              </p>
            )}
          </section>

          {data.pages.length > 0 && (
            <section
              aria-labelledby="focus-pages"
              className="space-y-2 rounded-xl border bg-card p-5"
            >
              <h2 id="focus-pages" className="flex items-center gap-2 font-medium">
                <Files size={16} className="text-muted-foreground" aria-hidden="true" />
                Pages in this project
                <span className="text-sm font-normal text-muted-foreground">
                  {data.pages.length}
                </span>
              </h2>
              <ul className="space-y-1">
                {data.pages.map((subpage) => (
                  <li key={subpage.id}>
                    <Link
                      href={`/pages/${subpage.id}`}
                      className="text-sm hover:underline"
                    >
                      {subpage.title || "Untitled"}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section
            aria-labelledby="focus-references"
            className="space-y-4 rounded-xl border bg-card p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="focus-references" className="flex items-center gap-2 font-medium">
                <Link2 size={16} className="text-muted-foreground" aria-hidden="true" />
                Related resources
              </h2>
              <span className="text-sm text-muted-foreground">
                {referenceCount === 0
                  ? "Nothing connected yet"
                  : `${referenceCount} connection${referenceCount === 1 ? "" : "s"}`}
              </span>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <h3 className="text-sm font-medium">
                  Linked pages
                  {data.references.links.length > 0 && (
                    <span className="ml-1 text-muted-foreground">
                      ({data.references.links.length})
                    </span>
                  )}
                </h3>
                {data.references.links.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No linked pages yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {data.references.links.map((page) => (
                      <li key={page.id}>
                        <Link
                          href={`/pages/${page.id}`}
                          className="text-sm hover:underline"
                        >
                          {page.title || "Untitled"}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="min-w-0 space-y-2">
                <h3 className="text-sm font-medium">
                  Backlinks
                  {data.references.backlinks.length > 0 && (
                    <span className="ml-1 text-muted-foreground">
                      ({data.references.backlinks.length})
                    </span>
                  )}
                </h3>
                {data.references.backlinks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No pages link here yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {data.references.backlinks.map((page) => (
                      <li key={page.id}>
                        <Link
                          href={`/pages/${page.id}`}
                          className="inline-flex items-center gap-1 text-sm hover:underline"
                        >
                          <span className="truncate">{page.title || "Untitled"}</span>
                          <ArrowUpRight size={13} aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="min-w-0 space-y-2 sm:col-span-2">
                <h3 className="text-sm font-medium">
                  Linked records
                  {data.references.records.length > 0 && (
                    <span className="ml-1 text-muted-foreground">
                      ({data.references.records.length})
                    </span>
                  )}
                </h3>
                {data.references.records.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No linked records yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {data.references.records.map((record) => (
                      <li key={record.id} className="flex items-center gap-2 text-sm">
                        <Link
                          href={`/databases/${record.databaseId}/records/${record.id}`}
                          className="min-w-0 flex-1 truncate hover:underline"
                        >
                          {record.title || "Untitled"}
                        </Link>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {record.databaseName}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
