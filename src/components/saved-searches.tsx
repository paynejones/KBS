"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { BookMarked, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  describeSavedSearch,
  savedSearchPageParams,
  type SavedSearch,
} from "@/lib/saved-searches";

type PagePreview = { id: string; title: string; updatedAt: string };
type SearchResult = { total: number; pages: PagePreview[]; failed: boolean };

const PREVIEW_LIMIT = 6;

/**
 * Collections are read through the page browser's own endpoint, so a saved
 * search never stores results: each visit counts and lists whatever matches
 * right now.
 */
async function fetchResults(searches: SavedSearch[]): Promise<Record<string, SearchResult>> {
  const entries = await Promise.all(
    searches.map(async (search) => {
      try {
        const response = await fetch(`/api/pages?${savedSearchPageParams(search).toString()}`);
        if (!response.ok) throw new Error("Failed to load pages.");
        const pages = await response.json() as PagePreview[];
        return [search.id, {
          total: pages.length,
          pages: pages.slice(0, PREVIEW_LIMIT),
          failed: false,
        }] as const;
      } catch {
        return [search.id, { total: 0, pages: [], failed: true }] as const;
      }
    }),
  );

  return Object.fromEntries(entries);
}

export function SavedSearches() {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [results, setResults] = useState<Record<string, SearchResult>>({});
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [tagId, setTagId] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SavedSearch | null>(null);
  const [deleting, setDeleting] = useState(false);
  const nameId = useId();
  const queryId = useId();
  const tagIdField = useId();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        // Tags are only needed to fill the form; a failed request there must
        // not hide the collections that loaded.
        const [searchResponse, tagResponse] = await Promise.all([
          fetch("/api/saved-searches"),
          fetch("/api/tags").catch(() => null),
        ]);
        if (!searchResponse.ok) throw new Error("Could not load saved searches.");

        const data = await searchResponse.json() as SavedSearch[];
        const loadedResults = await fetchResults(data);
        if (cancelled) return;

        setSearches(data);
        setResults(loadedResults);
        if (tagResponse?.ok) setTags(await tagResponse.json() as { id: string; name: string }[]);
      } catch {
        if (!cancelled) setLoadError("Could not load saved searches.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [retryKey]);

  async function createSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          query: query.trim(),
          tagId: tagId || null,
          favoritesOnly,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "Could not save the collection.");
      }

      const created = await response.json() as SavedSearch;
      const next = [created, ...searches];
      setName("");
      setQuery("");
      setTagId("");
      setFavoritesOnly(false);
      setSearches(next);
      setResults(await fetchResults(next));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the collection.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSearch(search: SavedSearch) {
    setDeleting(true);
    setError("");

    try {
      const response = await fetch(`/api/saved-searches/${search.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete the collection.");
      setSearches((current) => current.filter((item) => item.id !== search.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete the collection.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-4xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Saved searches</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Collections that stay live. Each one runs its filters again every time
          you open it, so new pages join without being added by hand.
        </p>
      </header>

      <form onSubmit={createSearch} className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium">New collection</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor={nameId} className="grid gap-1 text-xs text-muted-foreground">
            Collection name
            <input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Reading queue"
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label htmlFor={queryId} className="grid gap-1 text-xs text-muted-foreground">
            Search terms
            <input
              id={queryId}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={200}
              placeholder="Words in a title or page"
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label htmlFor={tagIdField} className="grid gap-1 text-xs text-muted-foreground">
            Tag
            <select
              id={tagIdField}
              value={tagId}
              onChange={(event) => setTagId(event.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Any tag</option>
              {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              checked={favoritesOnly}
              onChange={(event) => setFavoritesOnly(event.target.checked)}
            />
            Favorites only
          </label>
        </div>
        <div className="flex items-center justify-end">
          <Button type="submit" disabled={!name.trim() || saving}>
            {saving ? "Saving…" : "Save search"}
          </Button>
        </div>
      </form>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div role="status" className="animate-pulse rounded-xl border p-8 text-sm text-muted-foreground">
          Loading collections…
        </div>
      ) : loadError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setRetryKey((current) => current + 1)}>
            Try again
          </Button>
        </div>
      ) : searches.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <BookMarked className="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-medium">No saved searches yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Name a search above and it becomes a collection that updates itself.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {searches.map((search) => {
            const result = results[search.id];
            return (
              <article key={search.id} id={`saved-search-${search.id}`} className="rounded-xl border bg-card p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-medium tracking-tight">{search.name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{describeSavedSearch(search)}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={deleting}
                    aria-label={`Delete ${search.name}`}
                    title="Delete this collection"
                    onClick={() => setPendingDelete(search)}
                  >
                    <Trash2 size={16} className="text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>

                {result?.failed ? (
                  <p className="mt-3 text-xs text-destructive">Could not count the pages in this collection.</p>
                ) : result ? (
                  <div className="mt-3 space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      {result.total} {result.total === 1 ? "page matches" : "pages match"} right now
                    </p>
                    {result.pages.length > 0 && (
                      <ul className="space-y-0.5">
                        {result.pages.map((matched) => (
                          <li key={matched.id}>
                            <Link
                              href={`/pages/${matched.id}`}
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                            >
                              <FileText size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                              <span className="min-w-0 truncate">{matched.title || "Untitled"}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    {result.total > result.pages.length && (
                      <p className="px-2 text-xs text-muted-foreground">
                        +{result.total - result.pages.length} more
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">Counting pages…</p>
                )}
              </article>
            );
          })}
        </div>
      )}

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.name ?? "collection"}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The pages it matched are not deleted. Only the saved filters go away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                const pending = pendingDelete;
                setPendingDelete(null);
                if (pending) void deleteSearch(pending);
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Delete search
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
