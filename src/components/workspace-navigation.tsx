"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Database,
  Files,
  GitFork,
  GripVertical,
  House,
  Inbox,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  activeNavigationKey,
  DEFAULT_MOBILE_ITEMS,
  DEFAULT_SIDEBAR_ORDER,
  getNavigationSnapshot,
  getServerNavigationSnapshot,
  isNavigationKey,
  mobileNavigationWithActive,
  moveNavigationKeyTo,
  NAVIGATION_ITEMS,
  storeNavigationPreferences,
  subscribeToNavigation,
  type NavigationItem,
  type NavigationKey,
} from "@/lib/navigation";

const iconByKey: Record<NavigationKey, LucideIcon> = {
  home: House,
  pages: Files,
  inbox: Inbox,
  databases: Database,
  favorites: Star,
  graph: GitFork,
  trash: Trash2,
};

/** The bottom bar keeps four short labels; the sidebar can spell them out. */
const mobileLabelByKey: Partial<Record<NavigationKey, string>> = {
  databases: "Data",
};

const itemByKey = new Map(
  NAVIGATION_ITEMS.map((item) => [item.key, item] as const),
);

export function WorkspaceNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const preferences = useSyncExternalStore(
    subscribeToNavigation,
    getNavigationSnapshot,
    getServerNavigationSnapshot,
  );

  const [draggingKey, setDraggingKey] = useState<NavigationKey | null>(null);
  const [dragOverKey, setDragOverKey] = useState<NavigationKey | null>(null);

  const activeKey = activeNavigationKey(pathname);

  if (mobile) {
    const keys = mobileNavigationWithActive(preferences.mobile, activeKey);

    return (
      <div className="flex w-full items-stretch" data-testid="mobile-navigation">
        {keys.map((key) => {
          const item = itemByKey.get(key);
          if (!item) return null;

          return (
            <NavigationLink
              key={key}
              item={item}
              active={key === activeKey}
              mobile
            />
          );
        })}
      </div>
    );
  }

  return (
    <nav className="space-y-0.5" aria-label="Workspace">
      {preferences.sidebar.map((key) => {
        const item = itemByKey.get(key);
        if (!item) return null;

        const active = key === activeKey;

        return (
          <div
            key={key}
            draggable
            onDragStart={(event) => {
              setDraggingKey(key);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", key);
            }}
            onDragEnd={() => {
              setDraggingKey(null);
              setDragOverKey(null);
            }}
            onDragOver={(event) => {
              if (!draggingKey || draggingKey === key) return;
              event.preventDefault();
              setDragOverKey(key);
            }}
            onDragLeave={() =>
              setDragOverKey((current) => (current === key ? null : current))
            }
            onDrop={(event) => {
              event.preventDefault();

              const dropped = event.dataTransfer.getData("text/plain");
              if (isNavigationKey(dropped)) {
                storeNavigationPreferences({
                  ...preferences,
                  sidebar: moveNavigationKeyTo(
                    preferences.sidebar,
                    dropped,
                    key,
                  ),
                });
              }

              setDraggingKey(null);
              setDragOverKey(null);
            }}
            className={`group relative rounded-md ${
              draggingKey === key ? "opacity-40" : ""
            } ${dragOverKey === key ? "ring-2 ring-brand" : ""}`}
          >
            <NavigationLink item={item} active={active} />
            <GripVertical
              size={13}
              aria-hidden="true"
              className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            />
          </div>
        );
      })}
    </nav>
  );
}

export function WorkspaceNavigationFallback({
  mobile = false,
}: {
  mobile?: boolean;
}) {
  const keys = mobile ? DEFAULT_MOBILE_ITEMS : DEFAULT_SIDEBAR_ORDER;

  if (mobile) {
    return (
      <div className="flex w-full items-stretch">
        {keys.map((key) => {
          const item = itemByKey.get(key);
          if (!item) return null;

          return <NavigationLink key={key} item={item} active={false} mobile />;
        })}
      </div>
    );
  }

  return (
    <nav className="space-y-0.5" aria-label="Workspace">
      {keys.map((key) => {
        const item = itemByKey.get(key);
        if (!item) return null;

        return <NavigationLink key={key} item={item} active={false} />;
      })}
    </nav>
  );
}

function NavigationLink({
  item,
  active,
  mobile = false,
}: {
  item: NavigationItem;
  active: boolean;
  mobile?: boolean;
}) {
  const Icon = iconByKey[item.key];

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={
        mobile
          ? `flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1 text-[11px] font-medium transition-colors ${
              active
                ? "text-brand"
                : "text-muted-foreground hover:text-foreground"
            }`
          : `flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1.5 pl-2.5 pr-7 text-[13px] transition-colors ${
              active
                ? "bg-brand-soft font-medium text-brand-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`
      }
    >
      <Icon
        size={mobile ? 19 : 15}
        aria-hidden="true"
        className={`shrink-0 ${active ? "text-brand" : ""}`}
      />
      <span className="truncate">
        {mobile ? (mobileLabelByKey[item.key] ?? item.label) : item.label}
      </span>
    </Link>
  );
}
