"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordHref } from "@/lib/record-link";

type PageRef = { id: string; title: string };
type Backlink = PageRef & { contexts: string[] };
type PageOption = PageRef & { parentId: string | null };
type LinkedRecord = PageRef & { databaseId: string; databaseName: string; pageId: string | null };
type RecordPicker = {
  records: LinkedRecord[];
  options: LinkedRecord[];
  hasMore: boolean;
};

async function fetchPageLinks(pageId: string): Promise<{ links: PageRef[]; backlinks: Backlink[] }> {
  const response = await fetch(`/api/pages/${pageId}/links`);
  if (!response.ok) throw new Error("Could not load page connections.");
  return (await response.json()) as { links: PageRef[]; backlinks: Backlink[] };
}

/**
 * The record picker asks the server for one screenful of titles, so opening a
 * page no longer reads every record in the workspace.
 */
async function fetchRecordPicker(pageId: string, query: string): Promise<RecordPicker> {
  const search = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  const response = await fetch(`/api/pages/${pageId}/records${search}`);
  if (!response.ok) throw new Error("Could not load page connections.");
  const data = (await response.json()) as {
    records: LinkedRecord[];
    options: LinkedRecord[];
    hasMore?: boolean;
  };
  return {
    records: data.records,
    options: data.options,
    hasMore: Boolean(data.hasMore),
  };
}

export function PageLinks({
  pageId,
  pages,
}: {
  pageId: string;
  pages: PageOption[];
}) {
  const [links, setLinks] = useState<PageRef[]>([]);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [records, setRecords] = useState<LinkedRecord[]>([]);
  const [recordOptions, setRecordOptions] = useState<LinkedRecord[]>([]);
  const [recordHasMore, setRecordHasMore] = useState(false);
  const [recordQuery, setRecordQuery] = useState("");
  const [targetId, setTargetId] = useState("");
  const [recordId, setRecordId] = useState("");
  const recordPickerId = useId();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadPageLinks = useCallback(async () => {
    const data = await fetchPageLinks(pageId);
    setLinks(data.links);
    setBacklinks(data.backlinks);
  }, [pageId]);

  const loadRecordPicker = useCallback(
    async (query: string) => {
      const data = await fetchRecordPicker(pageId, query);
      setRecords(data.records);
      setRecordOptions(data.options);
      setRecordHasMore(data.hasMore);
      // A chosen record may have been narrowed out of the list.
      setRecordId("");
    },
    [pageId],
  );

  const refreshConnections = useCallback(async () => {
    await Promise.all([loadPageLinks(), loadRecordPicker(recordQuery)]);
  }, [loadPageLinks, loadRecordPicker, recordQuery]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchPageLinks(pageId);
        if (!cancelled) {
          setLinks(data.links);
          setBacklinks(data.backlinks);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load page connections.",
          );
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  useEffect(() => {
    let cancelled = false;
    // Typing narrows the picker; the pause keeps one request per quiet moment.
    const timer = setTimeout(
      async () => {
        try {
          const data = await fetchRecordPicker(pageId, recordQuery);
          if (!cancelled) {
            setRecords(data.records);
            setRecordOptions(data.options);
            setRecordHasMore(data.hasMore);
            setRecordId("");
            setLoading(false);
          }
        } catch (loadError) {
          if (!cancelled) {
            setError(
              loadError instanceof Error
                ? loadError.message
                : "Could not load page connections.",
            );
            setLoading(false);
          }
        }
      },
      recordQuery.trim() ? 250 : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pageId, recordQuery]);

  async function addLink() {
    if (!targetId) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/pages/${pageId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPageId: targetId }),
      });
      if (!response.ok) throw new Error("Could not link this page.");
      setTargetId("");
      await refreshConnections();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not link this page.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeLink(targetPageId: string) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/pages/${pageId}/links`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPageId }),
      });
      if (!response.ok) throw new Error("Could not remove this page link.");
      await refreshConnections();
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

  async function addRecordLink() {
    if (!recordId) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/pages/${pageId}/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId }),
      });
      if (!response.ok) throw new Error("Could not link this record.");
      setRecordId("");
      await refreshConnections();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not link this record.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeRecordLink(linkedRecordId: string) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/pages/${pageId}/records`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: linkedRecordId }),
      });
      if (!response.ok) throw new Error("Could not remove this record link.");
      await refreshConnections();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not remove this record link.",
      );
    } finally {
      setSaving(false);
    }
  }

  const availablePages = pages.filter(
    (page) => page.id !== pageId && !links.some((link) => link.id === page.id),
  );

  const recordGroups = useMemo(() => {
    const groups = new Map<string, { databaseName: string; records: LinkedRecord[] }>();
    for (const option of recordOptions) {
      const group = groups.get(option.databaseId) ?? {
        databaseName: option.databaseName,
        records: [],
      };
      group.records.push(option);
      groups.set(option.databaseId, group);
    }
    return [...groups.entries()];
  }, [recordOptions]);

  return (
    <section className="space-y-4 rounded-lg border p-4" aria-labelledby="page-links-heading">
      <div className="flex items-center gap-2">
        <Link2 size={16} className="text-muted-foreground" />
        <h2 id="page-links-heading" className="font-medium">Page connections</h2>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <h3 className="text-sm font-medium">
            Linked pages
            {links.length > 0 && <span className="ml-1 text-muted-foreground">({links.length})</span>}
          </h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading links…</p>
          ) : links.length ? (
            <ul className="space-y-1">
              {links.map((page) => (
                <li key={page.id} className="flex items-center gap-2 text-sm">
                  <Link href={`/pages/${page.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    {page.title || "Untitled"}
                  </Link>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => void removeLink(page.id)}
                    disabled={saving}
                    aria-label={`Remove link to ${page.title || "Untitled"}`}
                    title="Remove link"
                  >
                    <Unlink size={15} />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No linked pages yet.</p>
          )}

          <div className="flex flex-col gap-2 pt-1 min-[360px]:flex-row">
            <select
              aria-label="Page connections: choose a page to link"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              disabled={saving || availablePages.length === 0}
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Choose a page…</option>
              {availablePages.map((page) => (
                <option key={page.id} value={page.id}>{page.title || "Untitled"}</option>
              ))}
            </select>
            <Button type="button" variant="outline" size="sm" onClick={() => void addLink()} disabled={!targetId || saving}>
              Add link
            </Button>
          </div>
        </div>

        <div className="min-w-0 space-y-2">
          <h3 className="text-sm font-medium">
            Backlinks
            {backlinks.length > 0 && <span className="ml-1 text-muted-foreground">({backlinks.length})</span>}
          </h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading backlinks…</p>
          ) : backlinks.length ? (
            <ul className="space-y-3">
              {backlinks.map((page) => (
                <li key={page.id}>
                  <Link href={`/pages/${page.id}`} className="inline-flex items-center gap-1 text-sm hover:underline">
                    <span className="truncate">{page.title || "Untitled"}</span>
                    <ArrowUpRight size={13} />
                  </Link>
                  {page.contexts.length > 0 && (
                    <ul className="mt-1 space-y-1 border-l pl-2 text-xs text-muted-foreground">
                      {page.contexts.map((context) => (
                        <li key={context} className="line-clamp-2">{context}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No pages link here yet.</p>
          )}
        </div>

        <div className="min-w-0 space-y-2 sm:col-span-2">
          <h3 className="text-sm font-medium">
            Linked records
            {records.length > 0 && <span className="ml-1 text-muted-foreground">({records.length})</span>}
          </h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading records…</p>
          ) : records.length ? (
            <ul className="space-y-1">
              {records.map((record) => (
                <li key={record.id} className="flex items-center gap-2 text-sm">
                  <Link
                    href={recordHref(record.databaseId, record.id, record.pageId)}
                    className="min-w-0 flex-1 truncate hover:underline"
                  >
                    {record.title || "Untitled"}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{record.databaseName}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => void removeRecordLink(record.id)}
                    disabled={saving}
                    aria-label={`Remove link to ${record.title || "Untitled"}`}
                    title="Remove record link"
                  >
                    <Unlink size={15} />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No linked records yet.</p>
          )}

          <div className="space-y-1.5 pt-1">
            <label htmlFor={recordPickerId} className="block text-sm text-muted-foreground">
              Link a record to this page
            </label>
            <div className="space-y-2">
              <input
                type="search"
                value={recordQuery}
                onChange={(event) => setRecordQuery(event.target.value)}
                placeholder="Search records…"
                aria-label="Search records to link"
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
              <div className="flex flex-col gap-2 min-[360px]:flex-row">
                <select
                  id={recordPickerId}
                  value={recordId}
                  onChange={(event) => setRecordId(event.target.value)}
                  disabled={saving || recordOptions.length === 0}
                  className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">Choose a record…</option>
                  {recordGroups.map(([databaseId, group]) => (
                    <optgroup key={databaseId} label={group.databaseName}>
                      {group.records.map((record) => (
                        <option key={record.id} value={record.id}>{record.title || "Untitled"}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void addRecordLink()}
                  disabled={!recordId || saving}
                >
                  Link record
                </Button>
              </div>
              {recordHasMore && (
                <p className="text-xs text-muted-foreground">
                  Showing the first {recordOptions.length} matches. Keep typing to narrow the list.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
