"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Search, TableProperties, X } from "lucide-react";

type PageResult = { id: string; title: string; updatedAt: string };
type RecordResult = { id: string; title: string; databaseId: string; databaseName: string };
type SearchResults = { pages: PageResult[]; records: RecordResult[] };

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({ pages: [], records: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }
    function handleOpenSearch() {
      setOpen(true);
    }
    window.addEventListener("keydown", handleShortcut);
    window.addEventListener("open-global-search", handleOpenSearch);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener("open-global-search", handleOpenSearch);
    };
  }, []);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!open || !normalizedQuery) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(normalizedQuery)}`);
        if (!response.ok) throw new Error("Search failed. Try again.");
        const data: SearchResults = await response.json();
        if (!cancelled) setResults(data);
      } catch (searchError) {
        if (!cancelled) setError(searchError instanceof Error ? searchError.message : "Search failed. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  function close() {
    setOpen(false);
    setQuery("");
    setResults({ pages: [], records: [] });
    setError("");
  }

  const hasResults = results.pages.length > 0 || results.records.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+K Meta+K"
        aria-label="Search pages and databases"
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search size={16} />
        <span className="hidden sm:inline">Search pages and databases</span>
        <kbd className="ml-2 hidden rounded border px-1.5 py-0.5 text-[10px] sm:inline">Ctrl K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
          onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          <section role="dialog" aria-modal="true" aria-label="Global search" className="w-full max-w-2xl overflow-hidden rounded-xl border bg-background shadow-2xl">
            <div className="flex items-center gap-3 border-b px-4">
              <Search size={18} className="shrink-0 text-muted-foreground" />
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setResults({ pages: [], records: [] });
                }}
                placeholder="Search page text and database records…"
                aria-label="Search page text and database records"
                className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
              <button type="button" onClick={close} aria-label="Close search" className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                <X size={17} />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-2">
              {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
              {loading && <p className="p-4 text-sm text-muted-foreground">Searching…</p>}
              {!loading && !error && query.trim() && !hasResults && <p className="p-4 text-sm text-muted-foreground">No matching pages or records.</p>}
              {!query.trim() && <p className="p-4 text-sm text-muted-foreground">Search titles, page content, and database record values.</p>}

              {results.pages.length > 0 && (
                <div className="mb-2">
                  <h2 className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pages</h2>
                  {results.pages.map((page) => (
                    <Link key={page.id} href={`/pages/${page.id}`} onClick={close} className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                      <FileText size={16} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{page.title || "Untitled"}</span>
                      <span className="text-xs text-muted-foreground">Updated {new Date(page.updatedAt).toLocaleDateString()}</span>
                    </Link>
                  ))}
                </div>
              )}

              {results.records.length > 0 && (
                <div>
                  <h2 className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Database records</h2>
                  {results.records.map((record) => (
                    <Link key={record.id} href={`/databases/${record.databaseId}`} onClick={close} className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                      <TableProperties size={16} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{record.title || "Untitled"}</span>
                      <span className="truncate text-xs text-muted-foreground">{record.databaseName}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t px-4 py-2 text-[11px] text-muted-foreground">
              <span>Search pages and structured records</span>
              <span>Esc to close</span>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
