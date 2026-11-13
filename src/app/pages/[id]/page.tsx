"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageEditorLoader } from "@/components/page-editor-loader";

function PageEditorContent() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";

  if (!id) return null;

  return <PageEditorLoader id={id} />;
}

export default function PageRoute() {
  return (
    <AppShell>
      <div className="mb-6">
        <Link
          href="/pages"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← All pages
        </Link>
      </div>

      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">
            Loading editor…
          </p>
        }
      >
        <PageEditorContent />
      </Suspense>
    </AppShell>
  );
}
