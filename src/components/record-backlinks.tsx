import Link from "next/link";
import { CornerDownRight } from "lucide-react";

export type RecordBacklink = {
  id: string;
  title: string;
  databaseId: string;
  databaseName: string;
  properties: string[];
};

/**
 * The far side of a relation: records in any database whose relation
 * properties point at this record. Each entry opens the pointing record, so a
 * connection can be followed in both directions.
 */
export function RecordBacklinks({ backlinks }: { backlinks: RecordBacklink[] }) {
  return (
    <section
      aria-labelledby="record-backlinks-heading"
      className="rounded-xl border bg-card p-4 sm:p-6"
    >
      <div className="flex items-center gap-2">
        <CornerDownRight size={16} className="text-muted-foreground" aria-hidden="true" />
        <h2
          id="record-backlinks-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Linked from
        </h2>
        {backlinks.length > 0 && (
          <span className="text-xs text-muted-foreground">({backlinks.length})</span>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Records whose relation properties point at this one.
      </p>

      {backlinks.length ? (
        <ul className="mt-4 space-y-1.5">
          {backlinks.map((backlink) => (
            <li key={backlink.id} className="min-w-0 text-sm">
              <Link
                href={`/databases/${backlink.databaseId}/records/${backlink.id}`}
                className="truncate font-medium hover:underline"
              >
                {backlink.title || "Untitled"}
              </Link>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {backlink.databaseName} · {backlink.properties.join(", ")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No records link here yet.</p>
      )}
    </section>
  );
}
