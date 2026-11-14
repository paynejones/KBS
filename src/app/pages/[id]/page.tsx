import { Suspense } from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { databaseRecords } from "@/db/schema";
import { AppShell } from "@/components/app-shell";
import { DatabaseRecordWorkspace } from "@/components/database-record";
import { PageEditorLoader } from "@/components/page-editor-loader";

/**
 * A database record owns its page, so opening the page opens the record: the
 * properties render as part of the page, edited in place by the same workspace
 * that serves /databases/[id]/records/[recordId]. Every other page is just an
 * editor.
 */
async function owningRecord(pageId: string) {
  if (!z.string().uuid().safeParse(pageId).success) return undefined;
  const [record] = await db
    .select({ id: databaseRecords.id, databaseId: databaseRecords.databaseId })
    .from(databaseRecords)
    .where(eq(databaseRecords.pageId, pageId))
    .limit(1);
  return record;
}

async function PageRouteContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const record = await owningRecord(id);

  if (record) {
    return <DatabaseRecordWorkspace databaseId={record.databaseId} recordId={record.id} />;
  }

  return (
    <AppShell>
      <div className="mb-6">
        <Link href="/pages" className="text-sm text-muted-foreground hover:text-foreground">
          ← All pages
        </Link>
      </div>

      <PageEditorLoader id={id} />
    </AppShell>
  );
}

export default function PageRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <AppShell>
          <p className="text-sm text-muted-foreground">Loading page…</p>
        </AppShell>
      }
    >
      <PageRouteContent params={params} />
    </Suspense>
  );
}
