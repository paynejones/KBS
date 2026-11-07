"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Link2Off } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

type OrphanPageItem = { id: string; title: string; updatedAt: string };
type OrphanRecordItem = OrphanPageItem & {
  databaseId: string;
  databaseName: string;
};
type OrphanSummary = {
  pages: OrphanPageItem[];
  records: OrphanRecordItem[];
  total: number;
};

export default function OrphansPage() {
  const [summary, setSummary] = useState<OrphanSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError("");
      try {
        const response = await fetch("/api/orphans");
        if (!response.ok) throw new Error("Could not scan for unconnected items.");
        const data: OrphanSummary = await response.json();
        if (!cancelled) setSummary(data);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not scan for unconnected items.",
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
  }, [attempt]);

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <Link href="/pages" className="text-sm text-muted-foreground hover:text-foreground">
            ← All pages
          </Link>
          <p className="mt-6 text-xs font-semibold tracking-[0.16em] text-muted-foreground">
            CONNECTIONS
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Unconnected</h1>
          <p className="mt-2 text-muted-foreground">
            Pages and records with no links, tags, hierarchy, or relations yet. Connect the
            ones worth keeping, and delete the rest.
          </p>
        </div>

        {error && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                setAttempt((current) => current + 1);
              }}
            >
              Try again
            </Button>
          </div>
        )}

        {loading ? (
          <div role="status" aria-label="Scanning for unconnected items" className="grid animate-pulse gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="grid gap-2 rounded-xl border bg-card p-4">
                <span className="h-4 w-2/5 rounded bg-muted" />
                <span className="h-3 w-1/4 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : summary && summary.total === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center">
            <p className="font-medium">Everything is connected</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Every page and record has a link, tag, relation, or place in the tree.
            </p>
          </div>
        ) : summary ? (
          <>
            <section aria-labelledby="orphan-pages-heading" className="space-y-3">
              <div className="flex items-baseline justify-between gap-3 border-b pb-2">
                <h2 id="orphan-pages-heading" className="font-medium">
                  Pages
                  <span className="ml-2 text-sm text-muted-foreground">{summary.pages.length}</span>
                </h2>
              </div>
              {summary.pages.length === 0 ? (
                <p className="text-sm text-muted-foreground">Every page is connected.</p>
              ) : (
                <ul className="divide-y rounded-xl border bg-card">
                  {summary.pages.map((page) => (
                    <li key={page.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <Link href={`/pages/${page.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                        {page.title || "Untitled"}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        Updated {new Date(page.updatedAt).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="orphan-records-heading" className="space-y-3">
              <div className="flex items-baseline justify-between gap-3 border-b pb-2">
                <h2 id="orphan-records-heading" className="font-medium">
                  Records
                  <span className="ml-2 text-sm text-muted-foreground">{summary.records.length}</span>
                </h2>
              </div>
              {summary.records.length === 0 ? (
                <p className="text-sm text-muted-foreground">Every record is connected.</p>
              ) : (
                <ul className="divide-y rounded-xl border bg-card">
                  {summary.records.map((record) => (
                    <li key={record.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/databases/${record.databaseId}/records/${record.id}`}
                          className="block truncate font-medium hover:underline"
                        >
                          {record.title || "Untitled"}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">{record.databaseName}</p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Updated {new Date(record.updatedAt).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <Link2Off size={20} className="mx-auto text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing to show yet. Create a page or record to scan for connections.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
