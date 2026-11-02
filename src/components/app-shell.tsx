
import { Suspense } from "react";
import Link from "next/link";
import { BookOpenText, UserRound } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { PageTree } from "@/components/page-tree";
import { GlobalSearch } from "@/components/global-search";
import { MobileSearchButton } from "@/components/mobile-search-button";
import { ThemePicker } from "@/components/theme-picker";
import {
  WorkspaceNavigation,
  WorkspaceNavigationFallback,
} from "@/components/workspace-navigation";

export function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full min-w-0 bg-background text-foreground">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r bg-muted/20 p-4 md:flex">
        <Link
          href="/"
          aria-label="Knowledge Base home"
          className="mb-8 flex items-center gap-3 px-2 text-lg font-semibold tracking-tight"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BookOpenText size={17} aria-hidden="true" />
          </span>
          KBS
        </Link>

        <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">
          WORKSPACE
        </div>

        <Suspense fallback={<WorkspaceNavigationFallback />}>
          <WorkspaceNavigation />
        </Suspense>

        <div className="mb-2 mt-7 flex items-center justify-between px-2 text-xs font-medium text-muted-foreground">
          <span>YOUR PAGES</span>
          <Link href="/pages" className="hover:text-foreground">
            View all
          </Link>
        </div>
        <PageTree />

        <Separator className="my-5" />

        <div className="mt-auto flex items-center gap-2 border-t px-2 pt-4 text-sm text-muted-foreground">
          <UserRound size={16} aria-hidden="true" />
          My workspace
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex h-14 items-center border-b px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <Link
              href="/"
              aria-label="Knowledge Base home"
              className="flex shrink-0 items-center gap-2 text-sm font-semibold md:hidden"
            >
              <BookOpenText size={17} aria-hidden="true" /> KBS
            </Link>
            <div className="ml-auto flex items-center gap-2 md:ml-0">
              <div className="hidden md:block">
                <GlobalSearch />
              </div>
              <ThemePicker />
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-7xl px-4 py-6 pb-24 sm:px-6 md:p-10">
          {children}
        </div>
      </main>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t bg-background/95 px-2 pb-[env(safe-area-inset-bottom)] pt-2 shadow-lg backdrop-blur md:hidden"
      >
        <Suspense fallback={<WorkspaceNavigationFallback mobile />}>
          <WorkspaceNavigation mobile />
        </Suspense>
        <MobileSearchButton />
      </nav>
    </div>
  );
}
