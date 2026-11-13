"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ButtonCell } from "@/components/button-cell";
import type { ListRow } from "@/lib/database-list";

/**
 * A scan-first view of the same records: one line per record, with the values
 * the view shows beside it. Records open their full page from the title.
 */
export function DatabaseList({
  databaseId,
  rows,
  onRunButton,
  onConfigureButton,
}: {
  databaseId: string;
  rows: ListRow[];
  onRunButton?: (recordId: string, propertyId: string, label: string) => Promise<string>;
  onConfigureButton?: (propertyId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No records match this filter.
      </p>
    );
  }

  return (
    <section aria-label="List view" className="divide-y rounded-xl border bg-card">
      {rows.map((row) => (
        <article key={row.id} className="flex flex-wrap items-start gap-3 p-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium">
              <Link
                href={`/databases/${databaseId}/records/${row.id}`}
                className="hover:text-primary hover:underline"
              >
                {row.title}
              </Link>
            </h2>
            {row.values.length > 0 && (
              <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {row.values.map((value) => (
                  <div key={value.id} className="flex min-w-0 items-baseline gap-1">
                    <dt>{value.name}</dt>
                    <dd className="min-w-0 break-words text-foreground">
                      {value.type === "button" && onRunButton ? (
                        <ButtonCell
                          compact
                          label={value.name}
                          onRun={() => onRunButton(row.id, value.id, value.name)}
                          onConfigure={onConfigureButton ? () => onConfigureButton(value.id) : undefined}
                        />
                      ) : value.display}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {row.pageId && (
            <Link
              href={`/pages/${row.pageId}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open page <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          )}
        </article>
      ))}
    </section>
  );
}
