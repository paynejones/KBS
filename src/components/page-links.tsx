"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";

type PageRef = { id: string; title: string };
type PageOption = PageRef & { parentId: string | null };

export function PageLinks({
  pageId,
  pages,
}: {
  pageId: string;
  pages: PageOption[];
}) {
  const [links, setLinks] = useState<PageRef[]>([]);
  const [backlinks, setBacklinks] = useState<PageRef[]>([]);
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadLinks() {
    try {
      const response = await fetch(`/api/pages/${pageId}/links`);
      if (!response.ok) throw new Error("Could not load page links.");
      const data: { links: PageRef[]; backlinks: PageRef[] } =
        await response.json();
      setLinks(data.links);
      setBacklinks(data.backlinks);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load page links.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function fetchLinks() {
      try {
        const response = await fetch(`/api/pages/${pageId}/links`);
        if (!response.ok) throw new Error("Could not load page links.");
        const data: { links: PageRef[]; backlinks: PageRef[] } =
          await response.json();
        if (!cancelled) {
          setLinks(data.links);
          setBacklinks(data.backlinks);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load page links.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchLinks();
    return () => {
      cancelled = true;
    };
  }, [pageId]);

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
      await loadLinks();
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
      await loadLinks();
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

  const availablePages = pages.filter(
    (page) => page.id !== pageId && !links.some((link) => link.id === page.id),
  );

  return (
    <section className="space-y-4 rounded-lg border p-4" aria-labelledby="page-links-heading">
      <div className="flex items-center gap-2">
        <Link2 size={16} className="text-muted-foreground" />
        <h2 id="page-links-heading" className="font-medium">Page connections</h2>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Linked pages</h3>
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
          <h3 className="text-sm font-medium">Backlinks</h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading backlinks…</p>
          ) : backlinks.length ? (
            <ul className="space-y-1">
              {backlinks.map((page) => (
                <li key={page.id}>
                  <Link href={`/pages/${page.id}`} className="inline-flex items-center gap-1 text-sm hover:underline">
                    <span className="truncate">{page.title || "Untitled"}</span>
                    <ArrowUpRight size={13} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No pages link here yet.</p>
          )}
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
