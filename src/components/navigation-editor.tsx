"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp, Check, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  defaultNavigationPreferences,
  getNavigationSnapshot,
  getServerNavigationSnapshot,
  MOBILE_NAVIGATION_LIMIT,
  moveNavigationKeyBy,
  NAVIGATION_ITEMS,
  storeNavigationPreferences,
  subscribeToNavigation,
  toggleMobileNavigationItem,
} from "@/lib/navigation";

export function NavigationEditor({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const preferences = useSyncExternalStore(
    subscribeToNavigation,
    getNavigationSnapshot,
    getServerNavigationSnapshot,
  );
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    dialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const itemByKey = new Map(
    NAVIGATION_ITEMS.map((item) => [item.key, item] as const),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/50 sm:items-start sm:p-4 sm:pt-[8vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="navigation-editor-heading"
        className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border bg-background shadow-2xl outline-none sm:max-h-[85vh] sm:rounded-xl"
      >
        <span
          aria-hidden="true"
          className="mx-auto mt-2 block h-1 w-10 rounded-full bg-border sm:hidden"
        />
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2
              id="navigation-editor-heading"
              className="font-semibold tracking-tight"
            >
              Edit navigation
            </h2>
            <p className="text-xs text-muted-foreground">
              Saved on this device.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation editor"
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={17} />
          </button>
        </div>

        <div className="space-y-6 p-4">
          <section aria-labelledby="navigation-order-heading">
            <h3
              id="navigation-order-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Sidebar order
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Drag a destination in the sidebar, or move it here with the arrow
              buttons.
            </p>

            <ul className="mt-3 space-y-1">
              {preferences.sidebar.map((key, index) => {
                const item = itemByKey.get(key);
                if (!item) return null;

                return (
                  <li
                    key={key}
                    className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {item.label}
                    </span>
                    <button
                      type="button"
                      aria-label={`Move ${item.label} up`}
                      disabled={index === 0}
                      onClick={() =>
                        storeNavigationPreferences({
                          ...preferences,
                          sidebar: moveNavigationKeyBy(
                            preferences.sidebar,
                            key,
                            "up",
                          ),
                        })
                      }
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${item.label} down`}
                      disabled={index === preferences.sidebar.length - 1}
                      onClick={() =>
                        storeNavigationPreferences({
                          ...preferences,
                          sidebar: moveNavigationKeyBy(
                            preferences.sidebar,
                            key,
                            "down",
                          ),
                        })
                      }
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="navigation-mobile-heading">
            <h3
              id="navigation-mobile-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Bottom bar
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose up to {MOBILE_NAVIGATION_LIMIT} destinations. Search and
              capture stay fixed.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {NAVIGATION_ITEMS.map((item) => {
                const selected = preferences.mobile.includes(item.key);
                const full =
                  !selected &&
                  preferences.mobile.length >= MOBILE_NAVIGATION_LIMIT;

                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={selected}
                    disabled={full}
                    onClick={() =>
                      storeNavigationPreferences({
                        ...preferences,
                        mobile: toggleMobileNavigationItem(
                          preferences.mobile,
                          item.key,
                        ),
                      })
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 ${
                      selected
                        ? "border-primary/30 bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {selected && <Check size={12} aria-hidden="true" />}
                    {item.label}
                  </button>
                );
              })}
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              {preferences.mobile.length} of {MOBILE_NAVIGATION_LIMIT} selected
            </p>
          </section>
        </div>

        <div className="flex items-center justify-between gap-2 border-t bg-muted/40 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              storeNavigationPreferences(defaultNavigationPreferences())
            }
          >
            <RotateCcw size={14} />
            Reset
          </Button>
          <Button type="button" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </section>
    </div>
  );
}
