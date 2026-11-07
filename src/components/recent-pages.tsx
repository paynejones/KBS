"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  clearRecentPages,
  formatRecentTime,
  getEmptyRecentPagesSnapshot,
  getRecentPagesSnapshot,
  subscribeToRecentPages,
} from "@/lib/recents";

export function RecentPages() {
  const recents = useSyncExternalStore(
    subscribeToRecentPages,
    getRecentPagesSnapshot,
    getEmptyRecentPagesSnapshot,
  );
  const [recordPageIds, setRecordPageIds] = useState<Set<string>>(() => new Set());
  const hasRecents = recents.length > 0;

  useEffect(() => {
    if (!hasRecents) return;
    let cancelled = false;

    async function loadRecordPageIds() {
      try {
        const response = await fetch("/api/graph");
        if (!response.ok) return;
        const data: { nodes: { id: string; isRecordPage?: boolean }[] } = await response.json();
        if (cancelled) return;
        setRecordPageIds(
          new Set(data.nodes.filter((node) => node.isRecordPage).map((node) => node.id)),
        );
      } catch {
        // Recents are a convenience: if the marker is unavailable, show them.
      }
    }

    void loadRecordPageIds();
    return () => {
      cancelled = true;
    };
  }, [hasRecents]);

  const visibleRecents = recents.filter((page) => !recordPageIds.has(page.id));

  if (visibleRecents.length === 0) return null;

  return (
    <section className="space-y-4" aria-labelledby="jump-back-in-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock size={17} className="text-muted-foreground" aria-hidden="true" />
          <h2 id="jump-back-in-heading" className="text-xl font-semibold tracking-tight">
            Jump back in
          </h2>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={clearRecentPages}>
          Clear
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {visibleRecents.slice(0, 4).map((page) => (
          <Link
            key={page.id}
            href={`/pages/${page.id}`}
            className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/25 hover:bg-accent/40"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium group-hover:text-primary">
                {page.title || "Untitled"}
              </span>
              <time
                dateTime={new Date(page.visitedAt).toISOString()}
                className="mt-1 block text-xs text-muted-foreground"
              >
                Visited {formatRecentTime(page.visitedAt)}
              </time>
            </span>
            <ArrowRight
              size={15}
              className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
