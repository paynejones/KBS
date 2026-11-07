import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { DatabaseRecordWorkspace } from "@/components/database-record";

async function DatabaseRecordRouteContent({
  params,
}: {
  params: Promise<{ id: string; recordId: string }>;
}) {
  const { id, recordId } = await params;
  return <DatabaseRecordWorkspace databaseId={id} recordId={recordId} />;
}

export default function DatabaseRecordPage({
  params,
}: {
  params: Promise<{ id: string; recordId: string }>;
}) {
  return (
    <Suspense
      fallback={
        <AppShell>
          <p className="text-sm text-muted-foreground">Loading record…</p>
        </AppShell>
      }
    >
      <DatabaseRecordRouteContent params={params} />
    </Suspense>
  );
}
