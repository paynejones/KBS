"use client";

import { useEffect, useState } from "react";
import { Download, HardDrive, RotateCcw, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

type TrashItem = {
  id: string;
  title: string;
  deletedAt: string | null;
  isInbox: boolean;
  descendantCount: number;
};

type OrphanSummary = { count: number; bytes: number };

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

export default function TrashPage() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<OrphanSummary | null>(null);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [trashResponse, orphansResponse] = await Promise.all([
          fetch("/api/trash"),
          fetch("/api/attachments/orphans"),
        ]);
        if (!trashResponse.ok) throw new Error("Could not load the trash.");

        const trashData: { items: TrashItem[] } = await trashResponse.json();
        if (cancelled) return;
        setItems(trashData.items);

        if (orphansResponse.ok) {
          const orphanData: OrphanSummary = await orphansResponse.json();
          if (!cancelled) {
            setOrphans({ count: orphanData.count, bytes: orphanData.bytes });
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load the trash.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function restore(item: TrashItem) {
    setBusyId(item.id);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`/api/trash/${item.id}/restore`, { method: "POST" });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not restore the page.");
      }
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setStatus(`Restored “${item.title || "Untitled"}”.`);
      window.dispatchEvent(new Event("pages-updated"));
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Could not restore the page.");
    } finally {
      setBusyId(null);
    }
  }

  async function purge(item: TrashItem) {
    const nested =
      item.descendantCount > 0
        ? ` and ${item.descendantCount} nested page${item.descendantCount === 1 ? "" : "s"}`
        : "";
    const confirmed = window.confirm(
      `Permanently delete “${item.title || "Untitled"}”${nested}? Files used only by this page are removed too. This cannot be undone.`,
    );
    if (!confirmed) return;

    setBusyId(item.id);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`/api/trash/${item.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not delete the page.");
      }
      const result: { attachmentsRemoved: number; bytesFreed: number } = await response.json();
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setStatus(
        result.attachmentsRemoved > 0
          ? `Deleted “${item.title || "Untitled"}” and removed ${result.attachmentsRemoved} unused file(s).`
          : `Deleted “${item.title || "Untitled"}”.`,
      );
      window.dispatchEvent(new Event("pages-updated"));
    } catch (purgeError) {
      setError(purgeError instanceof Error ? purgeError.message : "Could not delete the page.");
    } finally {
      setBusyId(null);
    }
  }

  async function cleanUnusedFiles() {
    if (!orphans || orphans.count === 0) return;
    const confirmed = window.confirm(
      `Permanently delete ${orphans.count} unused file(s) (${formatBytes(orphans.bytes)})? No page, revision, or record references them.`,
    );
    if (!confirmed) return;

    setCleaning(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/attachments/orphans", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not remove the unused files.");
      const result: { removed: number; bytes: number } = await response.json();
      setOrphans({ count: 0, bytes: 0 });
      setStatus(
        result.removed > 0
          ? `Removed ${result.removed} unused file(s) and freed ${formatBytes(result.bytes)}.`
          : "No unused files were removed.",
      );
    } catch (cleanError) {
      setError(cleanError instanceof Error ? cleanError.message : "Could not remove the unused files.");
    } finally {
      setCleaning(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-10">
        <header>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">
            DATA SAFETY
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Trash</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Deleted pages stay here until you restore them or delete them permanently. A page is
            removed together with its subpages, so restoring always brings the whole subtree back.
          </p>
        </header>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {status && (
          <p role="status" className="text-sm text-muted-foreground">
            {status}
          </p>
        )}

        <section className="space-y-3" aria-labelledby="trashed-pages-heading">
          <h2 id="trashed-pages-heading" className="text-xl font-semibold tracking-tight">
            Deleted pages
          </h2>

          {loading ? (
            <div role="status" aria-label="Loading trashed pages" className="grid gap-2">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="h-16 animate-pulse rounded-xl border bg-card" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card p-8 text-center">
              <Trash2 size={22} className="mx-auto text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 font-medium">The trash is empty</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Deleting a page moves it here instead of removing it straight away.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.title || "Untitled"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Deleted {item.deletedAt ? new Date(item.deletedAt).toLocaleString() : "recently"}
                      {item.descendantCount > 0
                        ? ` · ${item.descendantCount} nested page${item.descendantCount === 1 ? "" : "s"}`
                        : ""}
                      {item.isInbox ? " · captured inbox item" : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyId !== null}
                      onClick={() => void restore(item)}
                    >
                      <RotateCcw size={15} /> Restore
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busyId !== null}
                      onClick={() => void purge(item)}
                      aria-label={`Delete ${item.title || "Untitled"} permanently`}
                    >
                      <Trash2 size={15} className="text-destructive" /> Delete forever
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="unused-files-heading">
          <h2 id="unused-files-heading" className="text-xl font-semibold tracking-tight">
            Unused files
          </h2>
          <div className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  <HardDrive size={17} className="text-muted-foreground" aria-hidden="true" />
                  {orphans === null
                    ? "Checking stored files…"
                    : orphans.count === 0
                      ? "No unused files"
                      : `${orphans.count} unused file${orphans.count === 1 ? "" : "s"} · ${formatBytes(orphans.bytes)}`}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Uploads that no page, page revision, database record, or template references
                  anymore. Removing them frees disk space and cannot be undone.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void cleanUnusedFiles()}
                disabled={cleaning || !orphans || orphans.count === 0}
              >
                {cleaning ? "Removing…" : "Remove unused files"}
              </Button>
            </div>
          </div>
        </section>

        <section className="space-y-3" aria-labelledby="backup-heading">
          <h2 id="backup-heading" className="text-xl font-semibold tracking-tight">
            Backup
          </h2>
          <div className="rounded-xl border bg-card p-5">
            <p className="font-medium">Download a workspace export</p>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              One JSON file with every page (including trashed pages), revision, tag, link,
              database, view, record, and template, plus a manifest of stored files. Attachment
              bytes stay in the attachments directory, so back that up too. Restore with{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">npm run restore:export</code>.
            </p>
            <a
              href="/api/export"
              download
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Download size={15} /> Download JSON export
            </a>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
