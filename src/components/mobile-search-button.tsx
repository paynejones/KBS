"use client";

import { Search } from "lucide-react";

/** Mobile search field: the mockup replaces a header icon with a visible input. */
export function MobileSearchButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("open-global-search"))}
      aria-label="Search"
      aria-keyshortcuts="Control+K Meta+K"
      className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Search size={16} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">Search anything</span>
      <kbd className="rounded border bg-background px-1 py-0.5 text-[10px]">
        Ctrl K
      </kbd>
    </button>
  );
}
