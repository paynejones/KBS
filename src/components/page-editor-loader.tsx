
"use client";

import dynamic from "next/dynamic";

const PageEditor = dynamic(
  () => import("@/components/page-editor").then((mod) => mod.PageEditor),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-muted-foreground">Loading editor…</p>
    ),
  },
);

export function PageEditorLoader({ id, hideTitle = false }: { id: string; hideTitle?: boolean }) {
  return <PageEditor id={id} hideTitle={hideTitle} />;
}
