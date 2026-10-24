
import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { PageEditorLoader } from "@/components/page-editor-loader";

function PageContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-muted-foreground">
          Loading editor…
        </p>
      }
    >
      <PageContentInner params={params} />
    </Suspense>
  );
}

async function PageContentInner({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <PageEditorLoader id={id} />;
}

export default function PageRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
            Loading page…
          </p>
        }
      >
        <PageContent params={params} />
      </Suspense>
    </AppShell>
  );
}
