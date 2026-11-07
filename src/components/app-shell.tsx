"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { BookOpenText, Search, SlidersHorizontal, UserRound } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { PageTree } from "@/components/page-tree";
import { CommandPalette } from "@/components/command-palette";
import { MobileSearchButton } from "@/components/mobile-search-button";
import {
  MobileQuickCaptureButton,
  QuickCapture,
} from "@/components/quick-capture";
import { ThemePicker } from "@/components/theme-picker";
import { NavigationEditor } from "@/components/navigation-editor";
import {
  WorkspaceNavigation,
  WorkspaceNavigationFallback,
} from "@/components/workspace-navigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [editingNavigation, setEditingNavigation] = useState(false);

  return (
    <div className="flex min-h-screen w-full min-w-0 bg-background text-foreground">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r bg-muted/20 p-4 md:flex">
        <Link
          href="/"
          aria-label="Knowledge Base home"
          className="mb-4 flex items-center gap-3 rounded-md px-2 text-lg font-semibold tracking-tight"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BookOpenText size={17} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block leading-tight">KBS</span>
            <span className="block text-xs font-normal text-muted-foreground">
              Personal workspace
            </span>
          </span>
        </Link>

        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("open-global-search"))}
          aria-keyshortcuts="Control+K Meta+K"
          className="mb-4 flex h-8 w-full items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search size={15} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left">Search…</span>
          <kbd className="rounded border px-1 py-0.5 text-[10px]">Ctrl K</kbd>
        </button>

        <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">
          WORKSPACE
        </div>

        <Suspense fallback={<WorkspaceNavigationFallback />}>
          <WorkspaceNavigation />
        </Suspense>

        <button
          type="button"
          onClick={() => setEditingNavigation(true)}
          className="mt-1 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SlidersHorizontal size={13} aria-hidden="true" />
          Edit navigation
        </button>

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
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <Link
              href="/"
              aria-label="Knowledge Base home"
              className="flex shrink-0 items-center gap-2 text-sm font-semibold md:hidden"
            >
              <BookOpenText size={17} aria-hidden="true" /> KBS
            </Link>
            <div className="ml-auto flex items-center gap-1.5 md:ml-0 md:gap-2">
              <div className="hidden sm:block">
                <QuickCapture />
              </div>
              <MobileSearchButton />
              <button
                type="button"
                onClick={() => setEditingNavigation(true)}
                aria-label="Edit navigation"
                className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
              >
                <SlidersHorizontal size={18} aria-hidden="true" />
              </button>
              <CommandPalette showTrigger={false} />
              <ThemePicker />
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-7xl px-4 py-6 pb-28 sm:px-6 md:p-10">
          {children}
        </div>
      </main>

      <div className="fixed bottom-24 right-4 z-40 md:hidden">
        <MobileQuickCaptureButton />
      </div>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1.5 shadow-lg backdrop-blur md:hidden"
      >
        <Suspense fallback={<WorkspaceNavigationFallback mobile />}>
          <WorkspaceNavigation mobile />
        </Suspense>
      </nav>

      <NavigationEditor
        open={editingNavigation}
        onClose={() => setEditingNavigation(false)}
      />
    </div>
  );
}
