"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookMarked, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  describeSavedSearch,
  savedSearchPageParams,
  type SavedSearch,
} from "@/lib/saved-searches";

type PagePreview = { id: string; title: string };
type CollectionResult = { total: number; pages: PagePreview[] };

/**
 * The page browser that lists every match. Favorites-only collections have
 * their own screen, which accepts the same query and tag filters.
 */
function allMatchesHref(search: SavedSearch): string {
  const params = new URLSearchParams();
  const query = search.query.trim();
  if (query) params.set("q", query);
  if (search.tagId) params.set("tagId", search.tagId);
  const base = search.favoritesOnly ? "/favorites" : "/pages";
  const queryString = params.toString();
  return queryString ? `${base}?${queryString}` : base;
}

/**
 * One saved collection at its own address. Like the searches screen it stores
 * no results: the count and preview are asked for again on every visit, so the
 * page always reflects the pages that match right now.
 */
export function SavedSearchCollection({ id }: { id: string }) {
  const [search, setSearch] = useState<SavedSearch | null>(null);
  const [result, setResult] = useState<CollectionResult | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setMissing(false);

      try {
        const listResponse = await fetch("/api/saved-searches");
        if (!listResponse.ok) throw new Error("Could not load this collection.");
        const searches = await listResponse.json() as SavedSearch[];
        const found = searches.find((candidate) => candidate.id === id);

        if (!found) {
          if (!cancelled) {
            setSearch(null);
            setResult(null);
            setMissing(true);
          }
          return;
        }

        const pageResponse = await fetch(
          `/api/pages?${savedSearchPageParams(found).toString()}`,
        );
        if (!pageResponse.ok) {
          throw new Error("Could not count the pages in this collection.");
        }
        const payload = await pageResponse.json() as CollectionResult;

        if (!cancelled) {
          setSearch(found);
          setResult(payload);
        }
      } catch (loadFailure) {
        if (!cancelled) {
          setError(
            loadFailure instanceof Error
              ? loadFailure.message
              : "Could not load this collection.",
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
  }, [id, retryKey]);

  return (
    <section className="mx-auto w-full max-w-4xl space-y-5">
      <Link
        href="/searches"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={15} aria-hidden="true" /> Saved searches
      </Link>

      {loading ? (
        <div role="status" className="animate-pulse rounded-xl border p-8 text-sm text-muted-foreground">
          Loading collection…
        </div>
      ) : missing ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <BookMarked className="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
          <h1 className="font-medium">This collection is no longer available</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted. A collection only holds filters, so no pages
            were removed with it.
          </p>
          <Link
            href="/searches"
            className="mt-4 inline-flex items-center gap-1 text-sm text-brand hover:underline"
          >
            Back to saved searches <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4"
        >
          <p className="text-sm text-destructive">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRetryKey((current) => current + 1)}
          >
            Try again
          </Button>
        </div>
      ) : search ? (
        <>
          <header>
            <h1 className="text-3xl font-semibold tracking-tight">{search.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {describeSavedSearch(search)}
            </p>
          </header>

          <div className="rounded-xl border bg-card p-4 sm:p-5">
            {result ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {result.total} {result.total === 1 ? "page matches" : "pages match"} right now
                </p>
                {result.pages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No pages match this collection right now.
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {result.pages.map((matched) => (
                      <li key={matched.id}>
                        <Link
                          href={`/pages/${matched.id}`}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-brand"
                        >
                          <FileText size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 truncate">{matched.title || "Untitled"}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {result.total > result.pages.length && (
                  <Link
                    href={allMatchesHref(search)}
                    className="inline-flex items-center gap-1 px-2 text-xs font-medium text-brand hover:underline"
                  >
                    +{result.total - result.pages.length} more{" "}
                    {result.total - result.pages.length === 1 ? "page" : "pages"}{" "}
                    <ArrowRight size={11} aria-hidden="true" />
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Counting pages…</p>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
