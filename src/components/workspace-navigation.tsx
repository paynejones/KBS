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
      <div
        className="flex w-full items-stretch"
        data-testid="mobile-navigation"
      >
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
    <nav className="space-y-1" aria-label="Workspace">
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
            } ${dragOverKey === key ? "ring-2 ring-primary" : ""}`}
          >
            <NavigationLink item={item} active={active} />
            <GripVertical
              size={13}
              aria-hidden="true"
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
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
    <nav className="space-y-1" aria-label="Workspace">
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
          ? `flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md px-1 text-[10px] font-medium transition-colors ${
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`
          : `flex min-w-0 flex-1 items-center gap-3 rounded-md py-2 pl-3 pr-8 text-sm transition-colors ${
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`
      }
    >
      <Icon size={mobile ? 18 : 16} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}
