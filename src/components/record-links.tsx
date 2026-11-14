"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";

type PageRef = { id: string; title: string };
type RecordConnections = { pages: PageRef[]; options: PageRef[]; hasMore?: boolean };

/** The picker asks for one screenful of titles instead of every page. */
async function fetchRecordConnections(recordId: string, query: string): Promise<RecordConnections> {
  const search = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  const response = await fetch(`/api/records/${recordId}/pages${search}`);
  if (!response.ok) throw new Error("Could not load linked pages.");
  return (await response.json()) as RecordConnections;
}

/**
 * The record side of a page/record connection. It writes the same rows the
 * page panel writes, so either side can create or remove the connection.
 */
export function RecordPageLinks({
  recordId,
  readOnly = false,
}: {
  recordId: string;
  readOnly?: boolean;
}) {
  const [pages, setPages] = useState<PageRef[]>([]);
  const [options, setOptions] = useState<PageRef[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadConnections = useCallback(
    async (search: string) => {
      const data = await fetchRecordConnections(recordId, search);
      setPages(data.pages);
      setOptions(data.options);
      setHasMore(Boolean(data.hasMore));
      // A chosen page may have been narrowed out of the list.
      setTargetId("");
    },
    [recordId],
  );

  useEffect(() => {
    let cancelled = false;
    // Typing narrows the picker; the pause keeps one request per quiet moment.
    const timer = setTimeout(
      async () => {
        try {
          const data = await fetchRecordConnections(recordId, query);
          if (!cancelled) {
            setPages(data.pages);
            setOptions(data.options);
            setHasMore(Boolean(data.hasMore));
            setTargetId("");
            setLoading(false);
          }
        } catch (loadError) {
          if (!cancelled) {
            setError(
              loadError instanceof Error
                ? loadError.message
                : "Could not load linked pages.",
            );
            setLoading(false);
          }
        }
      },
      query.trim() ? 250 : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recordId, query]);

  async function addLink() {
    if (!targetId) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/records/${recordId}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: targetId }),
      });
      if (!response.ok) throw new Error("Could not link this page.");
      setTargetId("");
      await loadConnections(query);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not link this page.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeLink(pageId: string) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/records/${recordId}/pages`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      if (!response.ok) throw new Error("Could not remove this page link.");
      await loadConnections(query);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not remove this page link.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="record-links-heading" className="rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Link2 size={16} className="text-muted-foreground" />
        <h2 id="record-links-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Linked pages
        </h2>
        {pages.length > 0 && (
          <span className="text-xs text-muted-foreground">({pages.length})</span>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Pages that belong with this record. The connection also appears on each page.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading linked pages…</p>
      ) : pages.length ? (
        <ul className="mt-4 space-y-1">
          {pages.map((page) => (
            <li key={page.id} className="flex items-center gap-2 text-sm">
              <Link href={`/pages/${page.id}`} className="min-w-0 flex-1 truncate hover:underline">
                {page.title || "Untitled"}
              </Link>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void removeLink(page.id)}
                  disabled={saving}
                  aria-label={`Remove link to ${page.title || "Untitled"}`}
                  title="Remove page link"
                >
                  <Unlink size={15} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No linked pages yet.</p>
      )}

      {!readOnly && (
      <div className="mt-4 space-y-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pages…"
          aria-label="Search pages to link"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        />
        <div className="flex gap-2">
          <select
            aria-label="Linked pages: choose a page to link"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            disabled={saving || options.length === 0}
            className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Choose a page…</option>
            {options.map((page) => (
              <option key={page.id} value={page.id}>{page.title || "Untitled"}</option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void addLink()}
            disabled={!targetId || saving}
          >
            Link page
          </Button>
        </div>
        {hasMore && (
          <p className="text-xs text-muted-foreground">
            Showing the first {options.length} matches. Keep typing to narrow the list.
          </p>
        )}
      </div>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  );
}
