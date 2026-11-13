"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookMarked,
  BookOpen,
  Database,
  FileText,
  Files,
  GitFork,
  House,
  Inbox,
  Lock,
  SlidersHorizontal,
  Star,
  Target,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { PageTree } from "@/components/page-tree";
import {
  activeNavigationKey,
  DEFAULT_MOBILE_ITEMS,
  DEFAULT_SIDEBAR_ORDER,
  getNavigationSnapshot,
  getServerNavigationSnapshot,
  mobileNavigationWithActive,
  NAVIGATION_ITEMS,
  setNavigationLocked,
  storeNavigationPreferences,
  subscribeToNavigation,
  type NavigationItem,
  type NavigationKey,
  type SidebarEntry,
  type SidebarSection,
} from "@/lib/navigation";

const iconByKey: Record<NavigationKey, LucideIcon> = {
  home: House,
  pages: Files,
  searches: BookMarked,
  reading: BookOpen,
  focus: Target,
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

type SidebarPageOption = { id: string; title: string };
type SidebarDatabaseOption = { id: string; name: string };

function pinnedIds(sections: SidebarSection[], kind: "page" | "database") {
  return [
    ...new Set(
      sections.flatMap((section) =>
        section.entries.flatMap((entry) =>
          entry.kind === kind ? [entry.id] : [],
        ),
      ),
    ),
  ];
}

export function WorkspaceNavigation({
  mobile = false,
  onEditNavigation,
}: {
  mobile?: boolean;
  onEditNavigation?: () => void;
}) {
  const pathname = usePathname();
  const preferences = useSyncExternalStore(
    subscribeToNavigation,
    getNavigationSnapshot,
    getServerNavigationSnapshot,
  );
  const [pageTitles, setPageTitles] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [databaseNames, setDatabaseNames] = useState<Map<string, string>>(
    () => new Map(),
  );

  const pageIds = useMemo(
    () => pinnedIds(preferences.sections, "page"),
    [preferences.sections],
  );
  const databaseIds = useMemo(
    () => pinnedIds(preferences.sections, "database"),
    [preferences.sections],
  );
  const pageIdsKey = pageIds.join("|");
  const databaseIdsKey = databaseIds.join("|");

  useEffect(() => {
    if (mobile) return;
    let cancelled = false;

    async function loadShortcutLabels() {
      const [pages, databases] = await Promise.all([
        pageIds.length > 0
          ? fetch("/api/pages")
              .then((response) => (response.ok ? response.json() : []))
              .then((rows: SidebarPageOption[]) =>
                rows.map((page) => [page.id, page.title] as const),
              )
              .catch(() => [])
          : Promise.resolve([]),
        databaseIds.length > 0
          ? fetch("/api/databases")
              .then((response) => (response.ok ? response.json() : []))
              .then((rows: SidebarDatabaseOption[]) =>
                rows.map((database) => [database.id, database.name] as const),
              )
              .catch(() => [])
          : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setPageTitles(new Map(pages));
      setDatabaseNames(new Map(databases));
    }

    void loadShortcutLabels();
    return () => {
      cancelled = true;
    };
  }, [databaseIds, databaseIdsKey, mobile, pageIds, pageIdsKey]);

  const activeKey = activeNavigationKey(pathname);
  const unlockNavigation = () =>
    storeNavigationPreferences(setNavigationLocked(preferences, false));

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
    <nav className="space-y-4" aria-label="Workspace">
      {preferences.sections.length === 0 && (
        <div className="flex items-center justify-between gap-2 px-2 text-xs text-muted-foreground">
          <span>No sidebar sections</span>
          {preferences.locked ? (
            <UnlockNavigationButton onClick={unlockNavigation} />
          ) : (
            onEditNavigation && <EditNavigationButton onClick={onEditNavigation} />
          )}
        </div>
      )}

      {preferences.sections.map((section, sectionIndex) => {
        const entries = section.entries.filter(
          (entry) =>
            entry.kind !== "navigation" ||
            !preferences.hidden.includes(entry.key),
        );

        return (
          <section
            key={section.id}
            aria-labelledby={`sidebar-section-${sectionIndex}`}
            className="space-y-1"
          >
            <div className="flex items-center justify-between gap-1 pl-2 pr-1">
              <h2
                id={`sidebar-section-${sectionIndex}`}
                className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              >
                {section.name}
              </h2>
              {sectionIndex === 0 &&
                (preferences.locked ? (
                  <UnlockNavigationButton onClick={unlockNavigation} />
                ) : (
                  onEditNavigation && <EditNavigationButton onClick={onEditNavigation} />
                ))}
            </div>

            <div className="space-y-0.5">
              {entries.map((entry) => (
                <SidebarEntryRow
                  key={
                    entry.kind === "navigation"
                      ? `navigation:${entry.key}`
                      : entry.kind === "page-tree"
                        ? "page-tree"
                        : `${entry.kind}:${entry.id}`
                  }
                  entry={entry}
                  activeKey={activeKey}
                  pageTitles={pageTitles}
                  databaseNames={databaseNames}
                />
              ))}
            </div>
          </section>
        );
      })}
    </nav>
  );
}

function SidebarEntryRow({
  entry,
  activeKey,
  pageTitles,
  databaseNames,
}: {
  entry: SidebarEntry;
  activeKey: NavigationKey | null;
  pageTitles: Map<string, string>;
  databaseNames: Map<string, string>;
}) {
  if (entry.kind === "navigation") {
    const item = itemByKey.get(entry.key);
    if (!item) return null;
    return <NavigationLink item={item} active={entry.key === activeKey} />;
  }

  if (entry.kind === "page-tree") {
    return (
      <div>
        <div className="mb-1 flex items-center justify-between gap-1 px-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <span>Pages</span>
          <Link href="/pages" className="hover:text-foreground">
            View all
          </Link>
        </div>
        <PageTree />
      </div>
    );
  }

  if (entry.kind === "page") {
    return (
      <ShortcutLink
        href={`/pages/${entry.id}`}
        label={pageTitles.get(entry.id) || "Page"}
        icon={FileText}
      />
    );
  }

  return (
    <ShortcutLink
      href={`/databases/${entry.id}`}
      label={databaseNames.get(entry.id) || "Database"}
      icon={Database}
    />
  );
}

function ShortcutLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="flex min-w-0 items-center gap-2.5 rounded-md py-1.5 pl-2.5 pr-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon size={15} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function EditNavigationButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Edit navigation"
      title="Edit navigation"
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <SlidersHorizontal size={12} aria-hidden="true" />
    </button>
  );
}

function UnlockNavigationButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Unlock navigation editing"
      title="Navigation is locked"
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Lock size={12} aria-hidden="true" />
    </button>
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
    <nav className="space-y-4" aria-label="Workspace">
      <section className="space-y-1">
        <div className="pl-2 pr-1">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Workspace
          </h2>
        </div>
        <div className="space-y-0.5">
          {keys.map((key) => {
            const item = itemByKey.get(key);
            if (!item) return null;

            return <NavigationLink key={key} item={item} active={false} />;
          })}
        </div>
      </section>
      <section className="space-y-1">
        <div className="mb-1 flex items-center justify-between gap-1 px-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <span>Pages</span>
          <Link href="/pages" className="hover:text-foreground">
            View all
          </Link>
        </div>
        <PageTree />
      </section>
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
          : `flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1.5 pl-2.5 pr-2 text-[13px] transition-colors ${
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
