"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { BookOpen, ExternalLink, Trash2 } from "lucide-react";
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
  READING_KINDS,
  READING_KIND_LABELS,
  READING_STATUSES,
  READING_STATUS_LABELS,
  readingSourceLabel,
  readingStatusCounts,
  type ReadingHighlight,
  type ReadingItem,
  type ReadingKind,
  type ReadingStatus,
} from "@/lib/reading";

function ReadingCard({
  item,
  onChanged,
  onRemoved,
}: {
  item: ReadingItem;
  onChanged: (item: ReadingItem) => void;
  onRemoved: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"status" | "highlight" | "remove" | "">("");
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const statusId = useId();
  const highlightId = useId();
  const noteId = useId();
  const source = readingSourceLabel(item.url);

  async function changeStatus(status: ReadingStatus) {
    setBusy("status");
    setError("");

    try {
      const response = await fetch(`/api/reading/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => null) as
        | { error?: string; status?: ReadingStatus; updatedAt?: string }
        | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not update the status.");
      onChanged({
        ...item,
        status: payload?.status ?? status,
        updatedAt: payload?.updatedAt ?? item.updatedAt,
      });
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Could not update the status.");
    } finally {
      setBusy("");
    }
  }

  async function addHighlight(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || busy) return;

    setBusy("highlight");
    setError("");

    try {
      const response = await fetch(`/api/reading/${item.id}/highlights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft.trim(), note: note.trim() }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not save the highlight.");

      const created = payload as unknown as ReadingHighlight;
      onChanged({ ...item, highlights: [...item.highlights, created] });
      setDraft("");
      setNote("");
    } catch (highlightError) {
      setError(highlightError instanceof Error ? highlightError.message : "Could not save the highlight.");
    } finally {
      setBusy("");
    }
  }

  async function removeHighlight(highlightIdToRemove: string) {
    setBusy("highlight");
    setError("");

    try {
      const response = await fetch(`/api/reading/${item.id}/highlights/${highlightIdToRemove}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not remove the highlight.");
      onChanged({
        ...item,
        highlights: item.highlights.filter((highlight) => highlight.id !== highlightIdToRemove),
      });
    } catch (highlightError) {
      setError(highlightError instanceof Error ? highlightError.message : "Could not remove the highlight.");
    } finally {
      setBusy("");
    }
  }

  async function removeItem() {
    setBusy("remove");
    setError("");

    try {
      const response = await fetch(`/api/reading/${item.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not remove the item.");
      onRemoved(item.id);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove the item.");
      setBusy("");
    }
  }

  return (
    <article className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]">
              {READING_KIND_LABELS[item.kind]}
            </span>
            {item.author && <span className="min-w-0 truncate">{item.author}</span>}
          </div>
          <h3 className="mt-1 min-w-0 truncate font-medium tracking-tight">
            <Link href={`/pages/${item.pageId}`} className="hover:underline">
              {item.title || "Untitled"}
            </Link>
          </h3>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink size={12} aria-hidden="true" /> {source}
            </a>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <label htmlFor={statusId} className="sr-only">Reading status for {item.title}</label>
          <select
            id={statusId}
            value={item.status}
            disabled={busy === "status"}
            onChange={(event) => void changeStatus(event.target.value as ReadingStatus)}
            className="rounded-md border bg-background px-2 py-1.5 text-xs text-foreground"
          >
            {READING_STATUSES.map((status) => (
              <option key={status} value={status}>{READING_STATUS_LABELS[status]}</option>
            ))}
          </select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${item.title} from the reading list`}
            title="Remove from the reading list"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 size={16} className="text-muted-foreground hover:text-destructive" />
          </Button>
        </div>
      </div>

      <details className="mt-3 rounded-lg border bg-background/40 p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          Highlights ({item.highlights.length})
        </summary>

        {item.highlights.length > 0 ? (
          <ul className="mt-2 space-y-2.5">
            {item.highlights.map((highlight, index) => (
              <li key={highlight.id} className="border-l-2 border-brand pl-3">
                <p className="whitespace-pre-wrap break-words text-sm">{highlight.text}</p>
                {highlight.note && (
                  <p className="mt-1 text-xs text-muted-foreground">{highlight.note}</p>
                )}
                <button
                  type="button"
                  disabled={busy === "highlight"}
                  onClick={() => void removeHighlight(highlight.id)}
                  aria-label={`Remove highlight ${index + 1} from ${item.title}`}
                  className="mt-1 text-[11px] text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No highlights yet.</p>
        )}

        <form onSubmit={addHighlight} className="mt-3 space-y-1.5">
          <label htmlFor={highlightId} className="sr-only">Highlight from {item.title}</label>
          <textarea
            id={highlightId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            maxLength={4000}
            placeholder="Paste a passage…"
            className="w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <label htmlFor={noteId} className="sr-only">Note about this highlight</label>
          <input
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            placeholder="Why it matters (optional)"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" disabled={!draft.trim() || busy === "highlight"}>
            Add highlight
          </Button>
        </form>
      </details>

      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{item.title || "Untitled"}” from the reading list?</AlertDialogTitle>
            <AlertDialogDescription>
              The item and its highlights leave the list. Its notes page stays in Pages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "remove"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy === "remove"}
              onClick={() => {
                setConfirmOpen(false);
                void removeItem();
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Remove item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

export function ReadingList() {
  const [items, setItems] = useState<ReadingItem[]>([]);
  const [filter, setFilter] = useState<ReadingStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ReadingKind>("article");
  const [author, setAuthor] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<ReadingStatus>("to-read");
  const titleId = useId();
  const kindId = useId();
  const authorId = useId();
  const urlId = useId();
  const statusId = useId();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const response = await fetch("/api/reading");
        if (!response.ok) throw new Error("Could not load the reading list.");
        const data = await response.json() as ReadingItem[];
        if (!cancelled) setItems(data);
      } catch {
        if (!cancelled) setLoadError("Could not load the reading list.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [retryKey]);

  async function addItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || saving) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/reading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          kind,
          status,
          author: author.trim(),
          url: url.trim(),
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not add the item.");

      setItems((current) => [payload as unknown as ReadingItem, ...current]);
      setTitle("");
      setAuthor("");
      setUrl("");
      setKind("article");
      setStatus("to-read");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not add the item.");
    } finally {
      setSaving(false);
    }
  }

  function replaceItem(updated: ReadingItem) {
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  const counts = readingStatusCounts(items);
  const sections = (filter === "all" ? READING_STATUSES : [filter]).map((sectionStatus) => ({
    status: sectionStatus,
    items: items.filter((item) => item.status === sectionStatus),
  }));
  const visibleSections = sections.filter((section) => filter !== "all" || section.items.length > 0);
  const filterOptions: { value: ReadingStatus | "all"; label: string; count: number }[] = [
    { value: "all", label: "All", count: items.length },
    ...READING_STATUSES.map((option) => ({
      value: option,
      label: READING_STATUS_LABELS[option],
      count: counts[option],
    })),
  ];

  return (
    <section className="mx-auto w-full max-w-4xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Reading list</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Articles and books in one place. Every item owns a notes page, and the
          passages you keep stay beside it with the reason they mattered.
        </p>
      </header>

      <form onSubmit={addItem} className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium">Add something to read</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor={titleId} className="grid gap-1 text-xs text-muted-foreground">
            Title
            <input
              id={titleId}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder="The book or article"
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label htmlFor={kindId} className="grid gap-1 text-xs text-muted-foreground">
            Kind
            <select
              id={kindId}
              value={kind}
              onChange={(event) => setKind(event.target.value as ReadingKind)}
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground"
            >
              {READING_KINDS.map((option) => (
                <option key={option} value={option}>{READING_KIND_LABELS[option]}</option>
              ))}
            </select>
          </label>
          <label htmlFor={authorId} className="grid gap-1 text-xs text-muted-foreground">
            Author or site
            <input
              id={authorId}
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              maxLength={120}
              placeholder="Optional"
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label htmlFor={urlId} className="grid gap-1 text-xs text-muted-foreground">
            Link
            <input
              id={urlId}
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              maxLength={2048}
              placeholder="https://… (optional)"
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label htmlFor={statusId} className="grid gap-1 text-xs text-muted-foreground">
            Start as
            <select
              id={statusId}
              value={status}
              onChange={(event) => setStatus(event.target.value as ReadingStatus)}
              className="rounded-md border bg-background px-3 py-2 text-sm text-foreground"
            >
              {READING_STATUSES.map((option) => (
                <option key={option} value={option}>{READING_STATUS_LABELS[option]}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">A notes page is created with the item.</p>
          <Button type="submit" disabled={!title.trim() || saving}>
            {saving ? "Adding…" : "Add to reading list"}
          </Button>
        </div>
      </form>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter the reading list by status">
        {filterOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              filter === option.value
                ? "border-brand/40 bg-brand-soft font-medium text-brand-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {option.label} <span className="opacity-70">{option.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div role="status" className="animate-pulse rounded-xl border p-8 text-sm text-muted-foreground">
          Loading the reading list…
        </div>
      ) : loadError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setRetryKey((current) => current + 1)}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <BookOpen className="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-medium">Nothing to read yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add an article or book, then keep the passages worth remembering beside it.
          </p>
        </div>
      ) : visibleSections.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No items are {READING_STATUS_LABELS[filter as ReadingStatus].toLocaleLowerCase()} right now.
        </p>
      ) : (
        <div className="space-y-5">
          {visibleSections.map((section) => (
            <section key={section.status} aria-labelledby={`reading-${section.status}`} className="space-y-2">
              <h2 id={`reading-${section.status}`} className="text-lg font-semibold tracking-tight">
                {READING_STATUS_LABELS[section.status]}
                <span className="ml-2 text-sm font-normal text-muted-foreground">{section.items.length}</span>
              </h2>
              <div className="space-y-2">
                {section.items.map((item) => (
                  <ReadingCard
                    key={item.id}
                    item={item}
                    onChanged={replaceItem}
                    onRemoved={removeItem}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
