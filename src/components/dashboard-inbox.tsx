"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

type InboxItem = {
  id: string;
  title: string;
  sourceUrl: string | null;
  capturedAt: string | null;
  createdAt: string;
};

function hostnameFor(sourceUrl: string | null): string {
  if (!sourceUrl) return "Note";
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./i, "");
  } catch {
    return sourceUrl;
  }
}

function capturedLabel(item: InboxItem): string {
  const iso = item.capturedAt ?? item.createdAt;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The newest captures, with their source, waiting to be organized. */
export function DashboardInbox() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/inbox");
        if (!response.ok) throw new Error("Could not load the inbox.");
        const data: InboxItem[] = await response.json();
        if (!cancelled) setItems(data.slice(0, 4));
      } catch (loadFailure) {
        if (!cancelled) {
          setError(
            loadFailure instanceof Error
              ? loadFailure.message
              : "Could not load the inbox.",
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
  }, [retryKey]);

  return (
    <section aria-labelledby="inbox-widget-heading" className="rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
            <Inbox size={13} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="inbox-widget-heading" className="text-sm font-semibold tracking-tight">
              Inbox
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Recent captures waiting to be filed
            </p>
          </div>
        </div>
        <Link
          href="/inbox"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-brand"
        >
          Open inbox <ArrowRight size={12} aria-hidden="true" />
        </Link>
      </div>

      {error ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-destructive">{error}</p>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setRetryKey((current) => current + 1)}>
            Try again
          </Button>
        </div>
      ) : loading ? (
        <div role="status" aria-label="Loading inbox" className="mt-3 space-y-1.5">
          <div className="h-5 animate-pulse rounded bg-muted" />
          <div className="h-5 animate-pulse rounded bg-muted" />
        </div>
      ) : items.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Nothing captured yet. Quick capture saves a note or link here.
        </p>
      ) : (
        <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 items-baseline gap-2 border-b py-1.5 last:border-b-0"
            >
              <Link
                href={`/pages/${item.id}`}
                className="min-w-0 flex-1 truncate text-xs font-medium transition-colors hover:text-brand hover:underline"
              >
                {item.title || "Untitled capture"}
              </Link>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {hostnameFor(item.sourceUrl)}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {capturedLabel(item)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
