"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";

type FavoritePage = {
  id: string;
  title: string;
  updatedAt: string;
};

/** A short list of starred pages, kept as links to the pages themselves. */
export function DashboardFavorites() {
  const [pages, setPages] = useState<FavoritePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/pages?favorite=true");
        if (!response.ok) throw new Error("Could not load favorites.");
        const data: FavoritePage[] = await response.json();
        if (!cancelled) setPages(data.slice(0, 5));
      } catch (loadFailure) {
        if (!cancelled) {
          setError(
            loadFailure instanceof Error
              ? loadFailure.message
              : "Could not load favorites.",
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
    <section aria-labelledby="favorites-heading" className="rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
            <Star size={13} aria-hidden="true" />
          </span>
          <h2 id="favorites-heading" className="text-sm font-semibold tracking-tight">
            Favorites
          </h2>
        </div>
        <Link
          href="/favorites"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-brand"
        >
          All favorites <ArrowRight size={12} aria-hidden="true" />
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
        <div role="status" aria-label="Loading favorites" className="mt-3 space-y-1.5">
          <div className="h-5 animate-pulse rounded bg-muted" />
          <div className="h-5 animate-pulse rounded bg-muted" />
        </div>
      ) : pages.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Star a page to keep it here.
        </p>
      ) : (
        <ul className="mt-2">
          {pages.map((page) => (
            <li key={page.id} className="border-b py-1.5 last:border-b-0">
              <Link
                href={`/pages/${page.id}`}
                className="flex min-w-0 items-center gap-2 text-xs font-medium transition-colors hover:text-brand hover:underline"
              >
                <Star size={11} className="shrink-0 fill-amber-500 text-amber-500" aria-hidden="true" />
                <span className="min-w-0 truncate">{page.title || "Untitled"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
