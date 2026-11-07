"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ExternalLink, Inbox as InboxIcon, Link2, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { CaptureFilePicker } from "@/components/capture-file-picker";
import { InboxAttachmentPreview } from "@/components/inbox-attachment";
import { Button } from "@/components/ui/button";
import { validateCaptureFile } from "@/lib/inbox-capture";
import { uploadAttachment, type CapturedAttachment } from "@/lib/media";

type LinkPreview = {
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
};
type InboxItem = {
  id: string;
  title: string;
  content: string;
  sourceUrl: string | null;
  selectedText: string | null;
  linkPreview: LinkPreview | null;
  captureAttachment: CapturedAttachment | null;
  capturedAt: string | null;
  createdAt: string;
};
type DatabaseOption = { id: string; name: string };

function linkSource(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return { host: url.hostname.replace(/^www\./i, ""), path: `${url.pathname}${url.search}` };
  } catch {
    return { host: sourceUrl, path: "" };
  }
}

export default function InboxPage() {
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [databases, setDatabases] = useState<DatabaseOption[]>([]);
  const [targetDatabaseId, setTargetDatabaseId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadInbox() {
      try {
        const response = await fetch("/api/inbox");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load your inbox.");
        if (!cancelled) {
          setItems(data);
          setError("");
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load your inbox.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadInbox();
    const refresh = () => { void loadInbox(); };
    window.addEventListener("inbox-updated", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("inbox-updated", refresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadDatabases() {
      try {
        const response = await fetch("/api/databases");
        if (!response.ok) throw new Error("Could not load databases.");
        const data: DatabaseOption[] = await response.json();
        if (!cancelled) {
          setDatabases(data);
          setTargetDatabaseId(data[0]?.id ?? "");
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load databases.");
      }
    }
    void loadDatabases();
    return () => { cancelled = true; };
  }, []);

  function chooseFile(next: File) {
    const message = validateCaptureFile(next);
    setError(message ?? "");
    setFile(message ? null : next);
  }

  async function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      let attachmentId: string | undefined;
      if (file) {
        setUploading(true);
        const uploaded = await uploadAttachment(file);
        attachmentId = uploaded.id;
      }
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          sourceUrl,
          selectedText: sourceUrl.trim() ? selectedText : undefined,
          attachmentId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save this capture.");
      setItems((current) => [data, ...current]);
      setTitle("");
      setContent("");
      setSourceUrl("");
      setSelectedText("");
      setFile(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this capture.");
    } finally {
      setUploading(false);
      setSaving(false);
    }
  }

  async function makePage(item: InboxItem) {
    setError("");
    try {
      const response = await fetch(`/api/inbox/${item.id}`, { method: "PATCH" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not move this item to Pages.");
      window.dispatchEvent(new Event("pages-updated"));
      router.push(`/pages/${item.id}`);
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Could not move this item to Pages.");
    }
  }

  async function moveToDatabase(item: InboxItem) {
    if (!targetDatabaseId) return;
    setError("");
    try {
      const response = await fetch(`/api/inbox/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ databaseId: targetDatabaseId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not move this item to the database.");
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      router.push(`/databases/${targetDatabaseId}`);
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Could not move this item to the database.");
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><InboxIcon size={20} /></span>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Capture inbox</h1>
              <p className="mt-1 text-sm text-muted-foreground">Save a thought, a link, or a file now. Sort it into your pages when you’re ready.</p>
            </div>
          </div>
        </header>

        <form onSubmit={capture} className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
          <label className="sr-only" htmlFor="capture-title">Title</label>
          <input id="capture-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="Title (optional)" className="w-full bg-transparent text-lg font-medium outline-none placeholder:text-muted-foreground" />
          <label className="sr-only" htmlFor="capture-note">Quick note</label>
          <textarea id="capture-note" value={content} onChange={(event) => setContent(event.target.value)} rows={3} placeholder="Write a quick note…" className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground">
              <Link2 size={16} className="shrink-0" aria-hidden="true" />
              <span className="sr-only">Source URL</span>
              <input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Paste a link (optional)" className="min-w-0 flex-1 bg-transparent py-2 text-foreground outline-none placeholder:text-muted-foreground" />
            </label>
            <Button type="submit" disabled={saving || (!title.trim() && !content.trim() && !sourceUrl.trim() && !file)}>
              <Plus size={16} /> {uploading ? "Uploading…" : saving ? "Saving…" : "Capture"}
            </Button>
          </div>
          <CaptureFilePicker file={file} onSelect={chooseFile} onClear={() => setFile(null)} disabled={saving} />
          {sourceUrl.trim() && (
            <>
              <label className="sr-only" htmlFor="capture-selected-text">Selected text</label>
              <textarea id="capture-selected-text" value={selectedText} onChange={(event) => setSelectedText(event.target.value)} rows={2} maxLength={2000} placeholder="Paste the passage you want to keep (optional)" className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>

        <section aria-labelledby="inbox-items-heading" className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="inbox-items-heading" className="text-xl font-semibold tracking-tight">To sort <span className="text-sm font-normal text-muted-foreground">{items.length}</span></h2>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="target-database">Choose a database</label>
              <select id="target-database" value={targetDatabaseId} onChange={(event) => setTargetDatabaseId(event.target.value)} disabled={!databases.length} className="max-w-48 rounded-md border bg-background px-2.5 py-2 text-sm">
                {databases.length ? databases.map((database) => <option key={database.id} value={database.id}>{database.name}</option>) : <option value="">No databases</option>}
              </select>
              <Link href="/pages" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">Browse pages <ArrowRight size={15} /></Link>
            </div>
          </div>
          {loading ? <div role="status" className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Loading inbox…</div> : items.length ? items.map((item) => (
            <article key={item.id} className="rounded-xl border bg-card p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="break-words font-medium">{item.title || "Quick note"}</h3>
                  {item.content && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.content}</p>}
                  {item.captureAttachment && <InboxAttachmentPreview attachment={item.captureAttachment} />}
                  {item.sourceUrl && item.selectedText && (
                    <blockquote className="mt-3 border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground">
                      <p className="whitespace-pre-wrap break-words">{item.selectedText}</p>
                    </blockquote>
                  )}
                  {item.sourceUrl && (() => {
                    const source = linkSource(item.sourceUrl);
                    const preview = item.linkPreview;
                    return (
                      <div className="mt-4 overflow-hidden rounded-lg border bg-muted/20">
                        {preview?.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={preview.imageUrl}
                            alt=""
                            className="h-40 w-full border-b bg-background object-cover"
                            onError={(event) => { event.currentTarget.hidden = true; }}
                          />
                        )}
                        <div className="flex items-start gap-3 p-3">
                          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background text-muted-foreground">
                            {preview?.faviconUrl
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={preview.faviconUrl} alt="" className="size-5" onError={(event) => { event.currentTarget.hidden = true; }} />
                              : <ExternalLink size={16} aria-hidden="true" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{item.title || preview?.title || source.host}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {preview?.siteName ? `${preview.siteName} · ` : ""}{source.host}{source.path}
                            </p>
                            {preview?.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{preview.description}</p>}
                          </div>
                          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${source.host} in a new tab`} className="shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-accent">Open link</a>
                        </div>
                      </div>
                    );
                  })()}
                  <time className="mt-3 block text-xs text-muted-foreground" dateTime={item.capturedAt ?? item.createdAt}>Captured {new Date(item.capturedAt ?? item.createdAt).toLocaleString()}</time>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void makePage(item)}>Move to pages <ArrowRight size={14} /></Button>
                  <Button type="button" size="sm" disabled={!targetDatabaseId} onClick={() => void moveToDatabase(item)}>Move to database</Button>
                </div>
              </div>
            </article>
          )) : <div className="rounded-xl border border-dashed bg-card p-9 text-center"><InboxIcon className="mx-auto text-muted-foreground" size={24} /><p className="mt-3 font-medium">Your inbox is clear</p><p className="mt-1 text-sm text-muted-foreground">New notes, saved links, and files will show up here.</p></div>}
        </section>
      </div>
    </AppShell>
  );
}
