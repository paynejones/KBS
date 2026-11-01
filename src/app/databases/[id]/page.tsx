import { Suspense } from "react";
import { DatabaseWorkspace } from "@/components/database-workspace";
import { AppShell } from "@/components/app-shell";

async function DatabaseRouteContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DatabaseWorkspace id={id} />;
}

export default function DatabasePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<AppShell><p className="text-sm text-muted-foreground">Loading database…</p></AppShell>}>
      <DatabaseRouteContent params={params} />
    </Suspense>
  );
}
