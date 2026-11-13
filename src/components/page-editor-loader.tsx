"use client";

import { lazy, Suspense, useSyncExternalStore } from "react";

// `next/dynamic` with `ssr: false` leaves its Suspense boundary pending during
// server rendering in this Next.js version, so the editor never reaches the
// client. A client-only mount gate keeps the editor out of SSR without
// suspending on the server.
const PageEditor = lazy(() =>
  import("@/components/page-editor").then((mod) => ({ default: mod.PageEditor })),
);

const loadingState = (
  <p className="text-sm text-muted-foreground">Loading editor…</p>
);

// The server snapshot is false so the editor never renders during SSR; after
// hydration this flips to true and the lazy module loads on the client.
const subscribeToMount = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function PageEditorLoader({
  id,
  hideTitle = false,
  readOnly = false,
}: {
  id: string;
  hideTitle?: boolean;
  readOnly?: boolean;
}) {
  const mounted = useSyncExternalStore(
    subscribeToMount,
    getClientSnapshot,
    getServerSnapshot,
  );

  if (!mounted) return loadingState;

  return (
    <Suspense fallback={loadingState}>
      <PageEditor id={id} hideTitle={hideTitle} readOnly={readOnly} />
    </Suspense>
  );
}
