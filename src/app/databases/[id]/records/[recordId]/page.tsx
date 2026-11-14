import { Suspense } from "react";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { databaseRecords } from "@/db/schema";
import { AppShell } from "@/components/app-shell";
import { DatabaseRecordWorkspace } from "@/components/database-record";

/**
 * A record is its page. Opening the record route hands over to /pages/[pageId]
 * so the page URL is what stays in the address bar, keeping the query (such as
 * `?mode=view`) intact. A record that has no page yet (older data) falls back to
 * the record screen, which creates the page when it loads.
 */
async function RecordRouteContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; recordId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, recordId } = await params;

  if (z.string().uuid().safeParse(id).success && z.string().uuid().safeParse(recordId).success) {
    const [record] = await db
      .select({ pageId: databaseRecords.pageId })
      .from(databaseRecords)
      .where(and(eq(databaseRecords.id, recordId), eq(databaseRecords.databaseId, id)))
      .limit(1);

    if (record?.pageId) {
      const search = await searchParams;
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(search)) {
        if (typeof value === "string") query.set(key, value);
        else if (Array.isArray(value)) for (const entry of value) query.append(key, entry);
      }
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      redirect(`/pages/${record.pageId}${suffix}`);
    }
  }

  return <DatabaseRecordWorkspace databaseId={id} recordId={recordId} />;
}

export default function DatabaseRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; recordId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense
      fallback={
        <AppShell>
          <p className="text-sm text-muted-foreground">Loading record…</p>
        </AppShell>
      }
    >
      <RecordRouteContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
