"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Database,
  FileText,
  Plus,
  Search,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { DashboardWidgets } from "@/components/dashboard-widgets";
import { RecentPages } from "@/components/recent-pages";
import { Button } from "@/components/ui/button";

type PageSummary = {
  id: string;
  title: string;
  updatedAt: string;
  content?: string | null;
  tags?: { id: string; name: string }[];
};

const subscribeToMount = () => () => {};
const getMountedSnapshot = () => true;
const getServerMountedSnapshot = () => false;

function greetingForHour(hour: number): string {
  if (hour < 5) return "Still up?";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function isToday(iso: string, reference: Date): boolean {
  const date = new Date(iso);

  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

function formatEdited(iso: string, reference: number): string {
  const difference = reference - new Date(iso).getTime();

  if (!Number.isFinite(difference) || difference < 60_000) return "just now";

  const minutes = Math.floor(difference / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(iso).toLocaleDateString();
}

/**
 * Page content is stored as editor HTML. The resume cards only need a readable
 * preview, so tags are stripped and entities are decoded before trimming.
 */
function snippetFrom(content: string | null | undefined): string {
  if (!content) return "";

  return content
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export default function Home() {
  const router = useRouter();
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  // Prerendering must not freeze a build-time clock into the page: the server
  // snapshot is false, so the greeting and edit times resolve after hydration.
  const mounted = useSyncExternalStore(
    subscribeToMount,
    getMountedSnapshot,
    getServerMountedSnapshot,
  );
  const now = mounted ? new Date() : null;

  useEffect(() => {
    let cancelled = false;

    async function loadPages() {
      setLoading(true);
      setLoadError("");
      try {
        const response = await fetch("/api/pages");
        if (!response.ok) throw new Error("Could not load your pages.");
        const data: PageSummary[] = await response.json();
        if (!cancelled) {
          setLoadError("");
          setPages(
            [...data].sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
            ),
          );
        }
      } catch (loadFailure) {
        if (!cancelled) {
          setLoadError(
            loadFailure instanceof Error
              ? loadFailure.message
              : "Could not load your pages.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPages();
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  async function createPage() {
    setCreating(true);
    setCreateError("");
    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled" }),
      });
      if (!response.ok) throw new Error("Could not create a page.");
      const page: { id: string } = await response.json();
      router.push(`/pages/${page.id}`);
    } catch (createFailure) {
      setCreateError(
        createFailure instanceof Error
          ? createFailure.message
          : "Could not create a page.",
      );
      setCreating(false);
    }
  }

  const resumePages = pages.slice(0, 3);
  const referenceTime = now ? now.getTime() : 0;
  const editedToday = now
    ? pages.filter((page) => isToday(page.updatedAt, now)).length
    : 0;
  const dateLabel = now
    ? now.toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";
  const snippets: Record<string, string> = {};
  for (const page of pages) {
    const snippet = snippetFrom(page.content);
    if (snippet) snippets[page.id] = snippet;
  }

  const ledger = !now
    ? ""
    : loading
      ? "Loading your workspace…"
      : editedToday > 0
        ? `${editedToday} ${editedToday === 1 ? "page" : "pages"} edited today.`
        : "Nothing edited today — pick up where you left off.";

  return (
    <AppShell>
      <div className="space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p
              suppressHydrationWarning
              className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              {dateLabel}
            </p>
            <h1
              suppressHydrationWarning
              className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              {now ? greetingForHour(now.getHours()) : "Welcome back"}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{ledger}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => window.dispatchEvent(new Event("open-global-search"))}
              className="text-muted-foreground hover:text-foreground"
            >
              <Search size={15} aria-hidden="true" />
              Quick find
              <kbd className="ml-1 hidden rounded border px-1 py-0.5 text-[10px] sm:inline">
                Ctrl K
              </kbd>
            </Button>
            <Button onClick={() => void createPage()} disabled={creating}>
              <Plus size={16} aria-hidden="true" />
              {creating ? "Creating…" : "New page"}
            </Button>
          </div>
        </header>

        {createError && (
          <p role="alert" className="text-sm text-destructive">
            {createError}
          </p>
        )}

        {loadError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-card p-4"
          >
            <p className="text-sm text-destructive">{loadError}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                setRetryKey((current) => current + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : loading ? (
          <div className="space-y-8" role="status" aria-label="Loading your workspace">
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="h-32 animate-pulse rounded-xl border bg-card"
                />
              ))}
            </div>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <div className="h-64 animate-pulse rounded-xl border bg-card" />
              <div className="h-64 animate-pulse rounded-xl border bg-card" />
            </div>
          </div>
        ) : pages.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-10 text-center">
            <FileText className="mx-auto text-muted-foreground" size={22} />
            <p className="mt-3 font-medium">Start with a page</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Capture a note, plan a project, or write down an idea.
            </p>
            <Button
              className="mt-4"
              onClick={() => void createPage()}
              disabled={creating}
            >
              <Plus size={16} aria-hidden="true" /> Create your first page
            </Button>
          </div>
        ) : (
          <>
            <section aria-labelledby="resume-heading" className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2
                  id="resume-heading"
                  className="text-sm font-semibold tracking-tight"
                >
                  Pick up where you left off
                </h2>
                <Link
                  href="/pages"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-brand"
                >
                  All pages <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {resumePages.map((page, index) => (
                  <Link
                    key={page.id}
                    href={`/pages/${page.id}`}
                    className={`group min-w-0 flex-col gap-2 rounded-xl border bg-card p-3.5 transition-colors hover:border-brand/40 hover:shadow-sm ${
                      index > 0 ? "hidden sm:flex" : "flex"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
                        <FileText size={12} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-brand">
                        {page.title || "Untitled"}
                      </span>
                    </span>
                    <span className="line-clamp-2 min-h-[2.1rem] text-xs leading-relaxed text-muted-foreground">
                      {snippets[page.id] || "No content yet."}
                    </span>
                    <span className="mt-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      Edited {formatEdited(page.updatedAt, referenceTime)}
                      {page.tags?.[0] && (
                        <>
                          <span className="size-0.5 rounded-full bg-current" />
                          <span className="truncate">{page.tags[0].name}</span>
                        </>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
              <section aria-labelledby="recent-pages-heading" className="min-w-0">
                <RecentPages
                  snippets={snippets}
                  fallback={pages.slice(3, 7)}
                />
              </section>

              <section aria-labelledby="pinned-views-heading" className="min-w-0">
                <DashboardWidgets />
              </section>
            </div>
          </>
        )}

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Database size={14} aria-hidden="true" />
          <Link href="/databases" className="transition-colors hover:text-brand">
            Browse databases
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
