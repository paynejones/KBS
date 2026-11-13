"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  clearRecentPages,
  formatRecentTime,
  getEmptyRecentPagesSnapshot,
  getRecentPagesSnapshot,
  subscribeToRecentPages,
  type RecentPage,
} from "@/lib/recents";
import {
  getNavigationSnapshot,
  getServerNavigationSnapshot,
  subscribeToNavigation,
} from "@/lib/navigation";

type FallbackPage = {
  id: string;
  title: string;
  updatedAt: string;
};

type RecentRow = {
  id: string;
  title: string;
  meta: string;
};

function formatUpdated(iso: string): string {
  const then = new Date(iso).getTime();
  const difference = Date.now() - then;

  if (!Number.isFinite(difference) || difference < 60_000) return "just now";

  const minutes = Math.floor(difference / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(iso).toLocaleDateString();
}

export function RecentPages({
  snippets = {},
  fallback = [],
}: {
  snippets?: Record<string, string>;
  fallback?: FallbackPage[];
} = {}) {
  const recents = useSyncExternalStore(
    subscribeToRecentPages,
    getRecentPagesSnapshot,
    getEmptyRecentPagesSnapshot,
  );
  const showDatabasePages = useSyncExternalStore(
    subscribeToNavigation,
    getNavigationSnapshot,
    getServerNavigationSnapshot,
  ).showDatabasePages;
  const [recordPageIds, setRecordPageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const hasRecents = recents.length > 0;

  useEffect(() => {
    if (!hasRecents || showDatabasePages) return;
    let cancelled = false;

    async function loadRecordPageIds() {
      try {
        const response = await fetch("/api/graph");
        if (!response.ok) return;
        const data: { nodes: { id: string; isRecordPage?: boolean }[] } =
          await response.json();
        if (cancelled) return;
        setRecordPageIds(
          new Set(
            data.nodes
              .filter((node) => node.isRecordPage)
              .map((node) => node.id),
          ),
        );
      } catch {
        // Recents are a convenience: if the marker is unavailable, show them.
      }
    }

    void loadRecordPageIds();
    return () => {
      cancelled = true;
    };
  }, [hasRecents, showDatabasePages]);

  const visibleRecents: RecentPage[] = showDatabasePages
    ? recents
    : recents.filter((page) => !recordPageIds.has(page.id));

  const rows: RecentRow[] =
    visibleRecents.length > 0
      ? visibleRecents.slice(0, 4).map((page) => ({
          id: page.id,
          title: page.title || "Untitled",
          meta: `Visited ${formatRecentTime(page.visitedAt)}`,
        }))
      : fallback.slice(0, 4).map((page) => ({
          id: page.id,
          title: page.title || "Untitled",
          meta: `Updated ${formatUpdated(page.updatedAt)}`,
        }));

  if (rows.length === 0) return null;

  return (
    <section className="space-y-3" aria-labelledby="recent-pages-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="recent-pages-heading"
          className="text-sm font-semibold tracking-tight"
        >
          Recent pages
        </h2>
        {hasRecents ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearRecentPages}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            Clear
          </Button>
        ) : (
          <Link
            href="/pages"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-brand"
          >
            View all <ArrowRight size={13} aria-hidden="true" />
          </Link>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {rows.map((row) => (
          <Link
            key={row.id}
            href={`/pages/${row.id}`}
            className="group flex min-w-0 items-center gap-2.5 border-b px-3 py-2.5 transition-colors last:border-b-0 hover:bg-muted/40"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
              <FileText size={12} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium group-hover:text-brand">
                {row.title}
              </span>
              {snippets[row.id] && (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {snippets[row.id]}
                </span>
              )}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {row.meta}
            </span>
            <ArrowRight
              size={13}
              aria-hidden="true"
              className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
