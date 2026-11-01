"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Database, FileText, Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

type PageSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export default function Home() {
  const router = useRouter();
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadPages() {
      setLoading(true);
      setLoadError("");
      try {
        const response = await fetch("/api/pages");
        if (!response.ok) throw new Error("Could not load your pages.");
        const data: PageSummary[] = await response.json();
        if (!cancelled) {
          setLoadError("");
          setPages(
            data
              .sort(
                (a, b) =>
                  new Date(b.updatedAt).getTime() -
                  new Date(a.updatedAt).getTime(),
              )
              .slice(0, 6),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setLoadError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load your pages.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPages();
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  async function createPage() {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled" }),
      });
      if (!response.ok) throw new Error("Could not create a page.");
      const page: { id: string } = await response.json();
      router.push(`/pages/${page.id}`);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create a page.",
      );
      setCreating(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-10">
        <section className="relative overflow-hidden rounded-2xl border bg-card px-5 py-7 sm:px-9 sm:py-10">
          <div className="pointer-events-none absolute -right-12 -top-20 size-64 rounded-full bg-primary/5 blur-2xl" />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">
                YOUR WORKSPACE
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Welcome back
              </h1>
              <p className="mt-3 max-w-lg text-muted-foreground">
                Your notes, projects, and ideas—all in one place.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="w-full sm:w-auto"
                onClick={() => void createPage()}
                disabled={creating}
              >
                <Plus size={16} />
                {creating ? "Creating…" : "New page"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => router.push("/databases")}
              >
                <Database size={16} /> Browse databases
              </Button>
            </div>
          </div>
        </section>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <section className="space-y-4" aria-labelledby="recent-pages-heading">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="recent-pages-heading"
              className="text-xl font-semibold tracking-tight"
            >
              Recently updated
            </h2>
            <Link
              href="/pages"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              All pages <ArrowRight size={15} />
            </Link>
          </div>

          {loading ? (
            <div
              role="status"
              aria-label="Loading recent pages"
              className="grid gap-3 sm:grid-cols-2"
            >
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  className="flex h-[74px] animate-pulse items-center gap-3 rounded-xl border bg-card p-4"
                >
                  <span className="size-9 shrink-0 rounded-md bg-muted" />
                  <span className="grid flex-1 gap-2">
                    <span className="h-4 w-2/5 rounded bg-muted" />
                    <span className="h-3 w-1/4 rounded bg-muted" />
                  </span>
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-card p-4">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setLoading(true);
                  setRetryKey((current) => current + 1);
                }}
              >
                Try again
              </Button>
            </div>
          ) : pages.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {pages.map((page) => (
                <Link
                  key={page.id}
                  href={`/pages/${page.id}`}
                  className="group rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-sm"
                >
                  <div className="flex items-start gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <FileText size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium tracking-tight group-hover:text-primary">
                        {page.title || "Untitled"}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Updated {new Date(page.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <ArrowRight
                      size={16}
                      className="mt-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed bg-card p-8 text-center">
              <FileText className="mx-auto text-muted-foreground" size={22} />
              <p className="mt-3 font-medium">Start with a page</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Capture a note, plan a project, or write down an idea.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => void createPage()}
                disabled={creating}
              >
                <Plus size={16} /> Create your first page
              </Button>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
