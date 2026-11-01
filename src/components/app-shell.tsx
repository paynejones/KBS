
import { Suspense } from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { PageTree } from "@/components/page-tree";
import { GlobalSearch } from "@/components/global-search";
import { MobileSearchButton } from "@/components/mobile-search-button";
import { ThemePicker } from "@/components/theme-picker";
import { WorkspaceNavigation, WorkspaceNavigationFallback } from "@/components/workspace-navigation";

export function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full min-w-0 bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 border-r bg-muted/30 p-4 md:flex md:flex-col">
        <Link href="/" className="mb-8 text-lg font-semibold">
          Knowledge Base
        </Link>

        <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">
          WORKSPACE
        </div>

        <Suspense fallback={<WorkspaceNavigationFallback />}>
          <WorkspaceNavigation />
        </Suspense>

        <PageTree />

        <Separator className="my-5" />

        <div className="mt-auto flex items-center gap-2 px-2 text-sm text-muted-foreground">
          <Settings size={16} />
          Personal workspace
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex h-14 items-center border-b px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <Link href="/" className="truncate text-sm font-semibold md:hidden">Knowledge Base</Link>
            <div className="ml-auto flex items-center gap-2 md:ml-0">
              <GlobalSearch />
              <ThemePicker />
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-7xl px-4 py-6 pb-24 sm:px-6 md:p-10">
          {children}
        </div>
      </main>

      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 px-2 pb-[env(safe-area-inset-bottom)] pt-2 shadow-lg backdrop-blur md:hidden">
        <Suspense fallback={<WorkspaceNavigationFallback mobile />}>
          <WorkspaceNavigation mobile />
        </Suspense>
        <MobileSearchButton />
      </nav>
    </div>
  );
}
