"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

type ReadingItem = {
  id: string;
  pageId: string;
  title: string;
  kind: "article" | "book";
  status: "to-read" | "reading" | "finished";
  author: string | null;
};

/** What is being read now, falling back to the top of the to-read list. */
export function DashboardReading() {
  const [items, setItems] = useState<ReadingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/reading");
        if (!response.ok) throw new Error("Could not load the reading list.");
        const data: ReadingItem[] = await response.json();
        if (!cancelled) {
          const reading = data.filter((item) => item.status === "reading");
          const source = reading.length > 0
            ? reading
            : data.filter((item) => item.status === "to-read");
          setItems(source.slice(0, 4));
        }
      } catch (loadFailure) {
        if (!cancelled) {
          setError(
            loadFailure instanceof Error
              ? loadFailure.message
              : "Could not load the reading list.",
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
    <section aria-labelledby="reading-widget-heading" className="rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
            <BookOpen size={13} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="reading-widget-heading" className="text-sm font-semibold tracking-tight">
              Reading list
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Currently reading, or waiting to start
            </p>
          </div>
        </div>
        <Link
          href="/reading"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-brand"
        >
          Open list <ArrowRight size={12} aria-hidden="true" />
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
        <div role="status" aria-label="Loading reading list" className="mt-3 space-y-1.5">
          <div className="h-5 animate-pulse rounded bg-muted" />
          <div className="h-5 animate-pulse rounded bg-muted" />
        </div>
      ) : items.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Add a book or article to start a reading list.
        </p>
      ) : (
        <ul className="mt-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 items-baseline gap-2 border-b py-1.5 last:border-b-0"
            >
              <Link
                href={`/pages/${item.pageId}`}
                className="min-w-0 flex-1 truncate text-xs font-medium transition-colors hover:text-brand hover:underline"
              >
                {item.title || "Untitled"}
              </Link>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {item.author || (item.kind === "book" ? "Book" : "Article")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
