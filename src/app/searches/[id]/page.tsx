import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { SavedSearchCollection } from "@/components/saved-search-collection";

async function SavedSearchRouteContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SavedSearchCollection id={id} />;
}

/** One collection at its own address, so a home widget can open it directly. */
export default function SavedSearchRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-4xl">
            <div
              role="status"
              className="animate-pulse rounded-xl border p-8 text-sm text-muted-foreground"
            >
              Loading collection…
            </div>
          </div>
        }
      >
        <SavedSearchRouteContent params={params} />
      </Suspense>
    </AppShell>
  );
}
