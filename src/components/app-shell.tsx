"use client";

import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { BookOpenText, Search, Settings } from "lucide-react";
import { CommandPalette } from "@/components/command-palette";
import { MobileSearchButton } from "@/components/mobile-search-button";
import {
  MobileQuickCaptureButton,
  QuickCapture,
} from "@/components/quick-capture";
import { NavigationEditor } from "@/components/navigation-editor";
import {
  WorkspaceNavigation,
  WorkspaceNavigationFallback,
} from "@/components/workspace-navigation";
import {
  getNavigationSnapshot,
  getServerNavigationSnapshot,
  subscribeToNavigation,
} from "@/lib/navigation";
import {
  getServerSidebarCollapsedSnapshot,
  getSidebarCollapsedSnapshot,
  subscribeToSidebarCollapsed,
} from "@/lib/sidebar-collapse";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [editingNavigation, setEditingNavigation] = useState(false);
  const navigation = useSyncExternalStore(
    subscribeToNavigation,
    getNavigationSnapshot,
    getServerNavigationSnapshot,
  );
  const navigationLocked = navigation.locked;

  // Settings can open the navigation editor without owning its dialog state.
  useEffect(() => {
    function openNavigationEditor() {
      if (!navigationLocked) setEditingNavigation(true);
    }

    window.addEventListener("open-navigation-editor", openNavigationEditor);
    return () =>
      window.removeEventListener("open-navigation-editor", openNavigationEditor);
  }, [navigationLocked]);
  const sidebarCollapsed = useSyncExternalStore(
    subscribeToSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    getServerSidebarCollapsedSnapshot,
  );

  return (
    <div className="flex min-h-screen w-full min-w-0 bg-background text-foreground">
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r bg-muted/25 py-4 md:flex ${
          sidebarCollapsed ? "w-16 px-2" : "w-56 px-3"
        }`}
      >
        <div className={`mb-4 flex gap-1 ${sidebarCollapsed ? "flex-col items-center" : "items-center justify-between"}`}>
          <Link
            href="/"
            aria-label="Knowledge Base home"
            title={sidebarCollapsed ? "KBS home" : undefined}
            className={`flex min-w-0 items-center gap-2.5 rounded-md px-1.5 text-sm font-semibold tracking-tight ${
              sidebarCollapsed ? "justify-center" : ""
            }`}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand/60 text-white shadow-sm">
              <BookOpenText size={16} aria-hidden="true" />
            </span>
            {!sidebarCollapsed && (
              <span className="min-w-0">
                <span className="block leading-tight">KBS</span>
                <span className="block text-[11px] font-normal text-muted-foreground">
                  Personal workspace
                </span>
              </span>
            )}
          </Link>
        </div>

        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("open-global-search"))}
          aria-keyshortcuts="Control+K Meta+K"
          aria-label={sidebarCollapsed ? "Search" : undefined}
          title={sidebarCollapsed ? "Search (Ctrl K)" : undefined}
          className={`mb-4 flex h-8 w-full items-center rounded-lg border bg-background text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            sidebarCollapsed ? "justify-center px-0" : "gap-2 px-2.5"
          }`}
        >
          <Search size={14} aria-hidden="true" />
          {!sidebarCollapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-left text-[13px]">
                Search…
              </span>
              <kbd className="rounded border px-1 py-0.5 text-[10px]">Ctrl K</kbd>
            </>
          )}
        </button>

        <Suspense fallback={<WorkspaceNavigationFallback collapsed={sidebarCollapsed} />}>
          <WorkspaceNavigation collapsed={sidebarCollapsed} />
        </Suspense>

        <div
          className={`mt-auto flex border-t pt-4 text-[11px] text-muted-foreground ${
            sidebarCollapsed ? "flex-col items-center gap-1.5 px-0" : "items-center gap-2 px-1.5"
          }`}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand/60 text-[10px] font-semibold text-white">
            K
          </span>
          {!sidebarCollapsed && <span className="min-w-0 flex-1 truncate">My workspace</span>}
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings size={14} aria-hidden="true" />
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex h-14 items-center gap-2 border-b px-3 sm:px-6">
          <Link
            href="/"
            aria-label="Knowledge Base home"
            className="flex shrink-0 items-center gap-2 text-sm font-semibold md:hidden"
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand/60 text-white">
              <BookOpenText size={15} aria-hidden="true" />
            </span>
            KBS
          </Link>
          <div className="ml-auto flex items-center gap-1.5 md:ml-0 md:gap-2">
            <div className="hidden sm:block">
              <QuickCapture />
            </div>
            <Link
              href="/settings"
              aria-label="Settings"
              title="Settings"
              className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            >
              <Settings size={18} aria-hidden="true" />
            </Link>
            <CommandPalette showTrigger={false} />
          </div>
        </header>

        <div className="w-full px-4 pb-28 pt-4 sm:px-6 md:p-8">
          <div className="mb-4 md:hidden">
            <MobileSearchButton />
          </div>
          {children}
        </div>
      </main>

      <div className="fixed bottom-20 right-4 z-40 md:hidden">
        <MobileQuickCaptureButton />
      </div>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 shadow-[0_-8px_24px_-18px_rgba(0,0,0,0.45)] backdrop-blur md:hidden"
      >
        <Suspense fallback={<WorkspaceNavigationFallback mobile />}>
          <WorkspaceNavigation mobile />
        </Suspense>
      </nav>

      <NavigationEditor
        open={editingNavigation && !navigationLocked}
        onClose={() => setEditingNavigation(false)}
      />
    </div>
  );
}
