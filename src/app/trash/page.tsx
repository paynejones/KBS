"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
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
import { Button } from "@/components/ui/button";

type TrashItem = {
  id: string;
  title: string;
  deletedAt: string | null;
  isInbox: boolean;
  descendantCount: number;
};

export default function TrashPage() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingPurge, setPendingPurge] = useState<TrashItem | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const trashResponse = await fetch("/api/trash");
        if (!trashResponse.ok) throw new Error("Could not load the trash.");

        const trashData: { items: TrashItem[] } = await trashResponse.json();
        if (!cancelled) setItems(trashData.items);
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
                      onClick={() => setPendingPurge(item)}
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

        <p className="text-sm text-muted-foreground">
          Backups, workspace exports, and unused-file cleanup now live in{" "}
          <Link
            href="/settings#data"
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            Settings → Data & backups
          </Link>
          .
        </p>
      </div>

      <AlertDialog
        open={Boolean(pendingPurge)}
        onOpenChange={(open) => {
          if (!open) setPendingPurge(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{pendingPurge?.title || "Untitled"}” permanently?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingPurge && pendingPurge.descendantCount > 0
                ? `This also deletes ${pendingPurge.descendantCount} nested page${pendingPurge.descendantCount === 1 ? "" : "s"}. `
                : ""}
              Files used only by this page are removed too. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busyId !== null}
              onClick={() => {
                const pending = pendingPurge;
                setPendingPurge(null);
                if (pending) void purge(pending);
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
