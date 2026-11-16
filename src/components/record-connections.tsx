import { RecordBacklinks, type RecordBacklink } from "@/components/record-backlinks";
import { RecordPageLinks } from "@/components/record-links";

/**
 * The record's connections, shown only while the header's Connections control
 * is open: the reverse relations and the pages attached to the record. Keeping
 * it out of the closed page means the content starts right under the header.
 */
export function RecordConnections({
  recordId,
  backlinks,
  readOnly = false,
}: {
  recordId: string;
  backlinks: RecordBacklink[];
  readOnly?: boolean;
}) {
  return (
    <section
      id="record-connections"
      aria-label="Connections"
      className="space-y-6 rounded-xl border bg-card p-4 sm:p-6"
    >
      <RecordBacklinks backlinks={backlinks} />
      <RecordPageLinks recordId={recordId} readOnly={readOnly} />
    </section>
  );
}
