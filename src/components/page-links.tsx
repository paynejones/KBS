"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";

type PageRef = { id: string; title: string };
type Backlink = PageRef & { contexts: string[] };
type PageOption = PageRef & { parentId: string | null };
type LinkedRecord = PageRef & { databaseId: string; databaseName: string };
type PageConnections = {
  links: PageRef[];
  backlinks: Backlink[];
  records: LinkedRecord[];
  recordOptions: LinkedRecord[];
};

async function fetchPageConnections(pageId: string): Promise<PageConnections> {
  const [linksResponse, recordsResponse] = await Promise.all([
    fetch(`/api/pages/${pageId}/links`),
    fetch(`/api/pages/${pageId}/records`),
  ]);
  if (!linksResponse.ok || !recordsResponse.ok) {
    throw new Error("Could not load page connections.");
  }

  const pageLinks = (await linksResponse.json()) as {
    links: PageRef[];
    backlinks: Backlink[];
  };
  const recordLinks = (await recordsResponse.json()) as {
    records: LinkedRecord[];
    options: LinkedRecord[];
  };

  return {
    links: pageLinks.links,
    backlinks: pageLinks.backlinks,
    records: recordLinks.records,
    recordOptions: recordLinks.options,
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
  const [targetId, setTargetId] = useState("");
  const [recordId, setRecordId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const applyConnections = useCallback((data: PageConnections) => {
    setLinks(data.links);
    setBacklinks(data.backlinks);
    setRecords(data.records);
    setRecordOptions(data.recordOptions);
  }, []);

  const loadConnections = useCallback(async () => {
    applyConnections(await fetchPageConnections(pageId));
  }, [applyConnections, pageId]);

  useEffect(() => {
    let cancelled = false;

    async function fetchConnections() {
      try {
        const data = await fetchPageConnections(pageId);
        if (!cancelled) applyConnections(data);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load page connections.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchConnections();
    return () => {
      cancelled = true;
    };
  }, [applyConnections, pageId]);

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
      await loadConnections();
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
      await loadConnections();
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
      await loadConnections();
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
      await loadConnections();
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
        <div className="space-y-2">
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

          <div className="flex gap-2 pt-1">
            <select
              aria-label="Choose a page to link"
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

        <div className="space-y-2">
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

        <div className="space-y-2 sm:col-span-2">
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
                    href={`/databases/${record.databaseId}/records/${record.id}`}
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

          <div className="flex gap-2 pt-1">
            <select
              aria-label="Choose a record to link"
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
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
