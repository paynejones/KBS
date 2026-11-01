"use client";

import { Search } from "lucide-react";

export function MobileSearchButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("open-global-search"))}
      className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Search size={18} aria-hidden="true" />
      Search
    </button>
  );
}
