"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Target } from "lucide-react";
import type { FocusProgress, FocusTask } from "@/lib/focus";
import { saveTaskChecked } from "@/lib/focus-task-save";

type PinnedProject = {
  id: string;
  title: string;
  icon: string | null;
  progress: FocusProgress;
  /** Open tasks in document order; completed ones are left to the focus view. */
  tasks: FocusTask[];
  /** The last couple of check-offs, newest first. */
  recentlyCompleted: { text: string; completedAt: string }[];
};

/** Cards stay compact: a long project continues in the focus view. */
const VISIBLE_TASKS = 3;

function taskKey(task: FocusTask) {
  return `${task.pageId}:${task.path.join(".")}`;
}

/**
 * Pinned projects keep their remaining work visible on the home page, and the
 * next few open tasks can be checked off without leaving it. A checked task is
 * written back to its page through the same save the focus view uses.
 */
export function DashboardPinnedProjects() {
  const [projects, setProjects] = useState<PinnedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/focus/pinned");
        if (!response.ok) throw new Error("Could not load pinned projects.");
        const data = (await response.json()) as { projects: PinnedProject[] };
        if (!cancelled) setProjects(data.projects);
      } catch {
        // Progress is context, not content: a failed fetch hides the section.
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function completeTask(project: PinnedProject, task: FocusTask) {
    const key = taskKey(task);
    setSaving(key);
    setError("");

    // The card answers immediately; a failed save puts the card back.
    setProjects((current) =>
      current.map((entry) => {
        if (entry.id !== project.id) return entry;
        const done = entry.progress.done + 1;
        return {
          ...entry,
          tasks: entry.tasks.filter((open) => taskKey(open) !== key),
          progress: {
            ...entry.progress,
            done,
            open: Math.max(0, entry.progress.open - 1),
            percent:
              entry.progress.total === 0
                ? 0
                : Math.round((done / entry.progress.total) * 100),
          },
          recentlyCompleted: [
            { text: task.text, completedAt: new Date().toISOString() },
            ...entry.recentlyCompleted,
          ].slice(0, 2),
        };
      }),
    );

    try {
      await saveTaskChecked(task, true);
      window.dispatchEvent(new Event("pages-updated"));
    } catch (saveError) {
      setProjects((current) =>
        current.map((entry) => (entry.id === project.id ? project : entry)),
      );
      setError(
        saveError instanceof Error ? saveError.message : "Could not save that task.",
      );
    } finally {
      setSaving("");
    }
  }

  if (loading || failed || projects.length === 0) return null;

  return (
    <section aria-labelledby="pinned-projects-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="pinned-projects-heading" className="text-sm font-semibold tracking-tight">
          Pinned projects
        </h2>
        <Link
          href="/focus"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-brand"
        >
          Focus view <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <article
            key={project.id}
            className="min-w-0 rounded-xl border bg-card p-3.5 transition-colors hover:border-brand/40 hover:shadow-sm"
          >
            <Link
              href={`/focus?page=${project.id}`}
              className="group flex min-w-0 items-center gap-2"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
                {project.icon ? (
                  <span aria-hidden="true" className="text-[11px]">
                    {project.icon}
                  </span>
                ) : (
                  <Target size={12} aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-brand">
                {project.title || "Untitled"}
              </span>
            </Link>

            <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                {project.progress.done} of {project.progress.total} tasks done
              </span>
              <span className={project.progress.open === 0 ? "text-brand" : undefined}>
                {project.progress.open === 0
                  ? "Complete"
                  : `${project.progress.open} open`}
              </span>
            </div>

            <div
              role="progressbar"
              aria-label={`${project.title || "Untitled"} progress`}
              aria-valuemin={0}
              aria-valuemax={project.progress.total}
              aria-valuenow={project.progress.done}
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${project.progress.percent}%` }}
              />
            </div>

            {project.tasks.length > 0 && (
              <ul className="mt-2.5 space-y-1">
                {project.tasks.slice(0, VISIBLE_TASKS).map((task) => (
                  <li key={taskKey(task)}>
                    <label className="flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        aria-label={`Complete ${task.text}`}
                        checked={false}
                        disabled={saving === taskKey(task)}
                        onChange={() => void completeTask(project, task)}
                        className="mt-0.5 size-3.5 shrink-0 accent-[var(--brand)]"
                      />
                      <span className="break-words">{task.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {project.tasks.length > VISIBLE_TASKS && (
              <Link
                href={`/focus?page=${project.id}`}
                className="mt-1 inline-flex text-[11px] text-muted-foreground hover:text-foreground"
              >
                +{project.tasks.length - VISIBLE_TASKS} more
              </Link>
            )}

            {project.tasks.length === 0 && project.progress.open === 0 && (
              <p className="mt-2 text-[11px] font-medium text-brand">All tasks done</p>
            )}

            {project.recentlyCompleted.length > 0 && (
              <div className="mt-2.5 border-t pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Recently finished
                </p>
                <ul className="mt-1 space-y-0.5">
                  {project.recentlyCompleted.map((entry, index) => (
                    <li
                      key={`${entry.text}-${index}`}
                      title={new Date(entry.completedAt).toLocaleString()}
                      className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
                    >
                      <Check
                        size={11}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-brand"
                      />
                      <span className="truncate">{entry.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
