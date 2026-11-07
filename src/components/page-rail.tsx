"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

type Backlink = { id: string; title: string; contexts: string[] };
type OutlineHeading = { level: number; text: string };

export function PageRail({
  pageId,
  headings,
  wordCount,
  createdAt,
  parentId,
  parentTitle,
  isFavorite,
  onSelectHeading,
}: {
  pageId: string;
  headings: OutlineHeading[];
  wordCount: number;
  createdAt: string;
  parentId: string | null;
  parentTitle: string | null;
  isFavorite: boolean;
  onSelectHeading: (index: number) => void;
}) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadBacklinks() {
      try {
        const response = await fetch(`/api/pages/${pageId}/links`);
        if (!response.ok) return;
        const data: { backlinks: Backlink[] } = await response.json();
        if (!cancelled) setBacklinks(data.backlinks);
      } catch {
        // The rail is context, not a blocker: a failed fetch leaves it empty.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadBacklinks();
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  const created = createdAt ? new Date(createdAt) : null;
  const createdLabel =
    created && !Number.isNaN(created.getTime())
      ? created.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";

  return (
    <aside
      aria-label="Page details"
      className="hidden w-44 shrink-0 lg:block xl:w-48"
    >
      <div className="sticky top-4 space-y-6 border-l pl-4">
        {headings.length > 0 && (
          <section aria-labelledby="rail-contents-heading">
            <h2
              id="rail-contents-heading"
              className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground"
            >
              Contents
            </h2>
            <ul className="mt-2 space-y-0.5">
              {headings.map((heading, index) => (
                <li key={`${heading.text}-${index}`}>
                  <button
                    type="button"
                    onClick={() => onSelectHeading(index)}
                    className={`block w-full truncate border-l-2 py-1 text-left text-[11px] transition-colors ${
                      heading.level === 1
                        ? "pl-2"
                        : heading.level === 2
                          ? "pl-3"
                          : "pl-4"
                    } border-transparent text-muted-foreground hover:border-brand hover:text-brand`}
                  >
                    {heading.text}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="rail-properties-heading">
          <h2
            id="rail-properties-heading"
            className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground"
          >
            Properties
          </h2>
          <dl className="mt-2 space-y-1.5">
            <div className="flex items-baseline gap-2">
              <dt className="w-14 shrink-0 text-[11px] text-muted-foreground">
                Parent
              </dt>
              <dd className="min-w-0 truncate text-[11px]">
                {parentId ? (
                  <Link
                    href={`/pages/${parentId}`}
                    className="hover:text-brand hover:underline"
                  >
                    {parentTitle || "Untitled"}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Top level</span>
                )}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="w-14 shrink-0 text-[11px] text-muted-foreground">
                Favorite
              </dt>
              <dd className="text-[11px]">{isFavorite ? "Yes" : "No"}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="w-14 shrink-0 text-[11px] text-muted-foreground">
                Words
              </dt>
              <dd className="text-[11px] tabular-nums">{wordCount}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="rail-mentions-heading">
          <h2
            id="rail-mentions-heading"
            className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground"
          >
            Linked mentions
          </h2>
          {loading ? (
            <p className="mt-2 text-[11px] text-muted-foreground">Loading…</p>
          ) : backlinks.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {backlinks.slice(0, 4).map((backlink) => (
                <li key={backlink.id}>
                  <Link
                    href={`/pages/${backlink.id}`}
                    className="group block border-b pb-1.5 last:border-b-0"
                  >
                    <span className="flex items-center gap-1 text-[11px] font-medium group-hover:text-brand">
                      <span className="min-w-0 truncate">
                        {backlink.title || "Untitled"}
                      </span>
                      <ArrowUpRight size={11} aria-hidden="true" />
                    </span>
                    {backlink.contexts[0] && (
                      <span className="mt-0.5 line-clamp-2 block text-[10px] leading-snug text-muted-foreground">
                        {backlink.contexts[0]}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              No pages link here yet.
            </p>
          )}
        </section>

        <section aria-labelledby="rail-info-heading">
          <h2
            id="rail-info-heading"
            className="text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground"
          >
            Page info
          </h2>
          <dl className="mt-2 space-y-1.5">
            <div className="flex items-baseline gap-2">
              <dt className="w-14 shrink-0 text-[11px] text-muted-foreground">
                Created
              </dt>
              <dd className="text-[11px]">{createdLabel}</dd>
            </div>
          </dl>
        </section>
      </div>
    </aside>
  );
}
