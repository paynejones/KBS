"use client";

import { FormEvent, useEffect, useState } from "react";
import { Inbox, Link2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpen() { setOpen(true); }
    window.addEventListener("keydown", onShortcut);
    window.addEventListener("open-quick-capture", onOpen);
    return () => {
      window.removeEventListener("keydown", onShortcut);
      window.removeEventListener("open-quick-capture", onOpen);
    };
  }, []);

  function close() {
    setOpen(false);
    setError("");
    setSuccess(false);
  }

  async function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          sourceUrl,
          selectedText: sourceUrl.trim() ? selectedText : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save this capture.");
      setTitle("");
      setContent("");
      setSourceUrl("");
      setSelectedText("");
      setSuccess(true);
      window.dispatchEvent(new Event("inbox-updated"));
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "Could not save this capture.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setSuccess(false); }}
        aria-keyshortcuts="Control+Shift+K Meta+Shift+K"
        className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus size={16} aria-hidden="true" />
        <span>Capture</span>
        <kbd className="hidden rounded border px-1 py-0.5 text-[10px] text-muted-foreground lg:inline">Ctrl Shift K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="quick-capture-heading" className="w-full max-w-xl overflow-hidden rounded-xl border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 id="quick-capture-heading" className="flex items-center gap-2 font-semibold"><Inbox size={18} /> Quick capture</h2>
              <button type="button" onClick={close} aria-label="Close quick capture" className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X size={17} /></button>
            </div>
            {success ? (
              <div className="space-y-4 p-5">
                <p role="status" className="text-sm">Saved to your inbox.</p>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setSuccess(false)}>Capture another</Button>
                  <Button type="button" onClick={close}>Done</Button>
                </div>
              </div>
            ) : (
              <form onSubmit={capture} className="space-y-3 p-4 sm:p-5">
                <label className="sr-only" htmlFor="quick-capture-title">Title</label>
                <input id="quick-capture-title" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="Title (optional)" className="w-full bg-transparent text-lg font-medium outline-none placeholder:text-muted-foreground" />
                <label className="sr-only" htmlFor="quick-capture-content">Quick note</label>
                <textarea id="quick-capture-content" value={content} onChange={(event) => setContent(event.target.value)} rows={4} placeholder="Write a quick note…" className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <label className="flex min-w-0 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground">
                  <Link2 size={16} className="shrink-0" aria-hidden="true" />
                  <span className="sr-only">Source URL</span>
                  <input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Paste a link (optional)" className="min-w-0 flex-1 bg-transparent py-2 text-foreground outline-none placeholder:text-muted-foreground" />
                </label>
                {sourceUrl.trim() && (
                  <>
                    <label className="sr-only" htmlFor="quick-capture-selected">Selected text</label>
                    <textarea id="quick-capture-selected" value={selectedText} onChange={(event) => setSelectedText(event.target.value)} rows={2} maxLength={2000} placeholder="Paste the passage you want to keep (optional)" className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  </>
                )}
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <div className="flex items-center justify-between gap-3 border-t pt-3">
                  <span className="text-xs text-muted-foreground">Saved to your inbox</span>
                  <Button type="submit" disabled={saving || (!title.trim() && !content.trim() && !sourceUrl.trim())}><Plus size={16} />{saving ? "Saving…" : "Capture"}</Button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </>
  );
}

export function MobileQuickCaptureButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("open-quick-capture"))}
      aria-label="Quick capture"
      className="inline-flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95"
    >
      <Plus size={20} aria-hidden="true" />
    </button>
  );
}
