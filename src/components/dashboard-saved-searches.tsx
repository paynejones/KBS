"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

type SavedSearch = {
  id: string;
  name: string;
  query: string;
  tagName: string | null;
  favoritesOnly: boolean;
};

/** "design · #research · Favorites", or "All pages" for an empty filter set. */
function filterSummary(saved: SavedSearch): string {
  const parts: string[] = [];
  if (saved.query) parts.push(`“${saved.query}”`);
  if (saved.tagName) parts.push(`#${saved.tagName}`);
  if (saved.favoritesOnly) parts.push("Favorites");
  return parts.join(" · ") || "All pages";
}

/** Saved collections stay live on the searches screen, so rows link there. */
export function DashboardSavedSearches() {
  const [items, setItems] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/saved-searches");
        if (!response.ok) throw new Error("Could not load saved searches.");
        const data: SavedSearch[] = await response.json();
        if (!cancelled) setItems(data.slice(0, 4));
      } catch (loadFailure) {
        if (!cancelled) {
          setError(
            loadFailure instanceof Error
              ? loadFailure.message
              : "Could not load saved searches.",
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
  }, [retryKey]);

  return (
    <section aria-labelledby="saved-searches-heading" className="rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
            <Search size={13} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="saved-searches-heading" className="text-sm font-semibold tracking-tight">
              Saved searches
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Collections that stay up to date
            </p>
          </div>
        </div>
        <Link
          href="/searches"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-brand"
        >
          Open searches <ArrowRight size={12} aria-hidden="true" />
        </Link>
      </div>

      {error ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-destructive">{error}</p>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setRetryKey((current) => current + 1)}>
            Try again
          </Button>
        </div>
      ) : loading ? (
        <div role="status" aria-label="Loading saved searches" className="mt-3 space-y-1.5">
          <div className="h-5 animate-pulse rounded bg-muted" />
          <div className="h-5 animate-pulse rounded bg-muted" />
        </div>
      ) : items.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Save a search to keep a live collection here.
        </p>
      ) : (
        <ul className="mt-2">
          {items.map((item) => (
            <li key={item.id} className="border-b py-1.5 last:border-b-0">
              <Link
                href="/searches"
                className="flex min-w-0 items-baseline gap-2 text-xs transition-colors hover:text-brand"
              >
                <span className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {item.name}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {filterSummary(item)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
