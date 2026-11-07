"use client";

import { Search } from "lucide-react";

export function MobileSearchButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("open-global-search"))}
      aria-label="Search"
      aria-keyshortcuts="Control+K Meta+K"
      className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
    >
      <Search size={18} aria-hidden="true" />
    </button>
  );
}
