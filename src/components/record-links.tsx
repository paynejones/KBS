"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";

type PageRef = { id: string; title: string };
type RecordConnections = { pages: PageRef[]; options: PageRef[] };

async function fetchRecordConnections(recordId: string): Promise<RecordConnections> {
  const response = await fetch(`/api/records/${recordId}/pages`);
  if (!response.ok) throw new Error("Could not load linked pages.");
  return (await response.json()) as RecordConnections;
}

/**
 * The record side of a page/record connection. It writes the same rows the
 * page panel writes, so either side can create or remove the connection.
 */
export function RecordPageLinks({ recordId }: { recordId: string }) {
  const [pages, setPages] = useState<PageRef[]>([]);
  const [options, setOptions] = useState<PageRef[]>([]);
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadConnections = useCallback(async () => {
    const data = await fetchRecordConnections(recordId);
    setPages(data.pages);
    setOptions(data.options);
  }, [recordId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchRecordConnections(recordId);
        if (!cancelled) {
          setPages(data.pages);
          setOptions(data.options);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load linked pages.",
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
  }, [recordId]);

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
      await loadConnections();
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
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No linked pages yet.</p>
      )}

      <div className="mt-4 flex gap-2">
        <select
          aria-label="Choose a page to link"
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

      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  );
}
