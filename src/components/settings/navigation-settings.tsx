"use client";

import { useState, useSyncExternalStore } from "react";
import { Lock, PanelLeftClose, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/settings-section";
import {
  defaultNavigationPreferences,
  getNavigationSnapshot,
  getServerNavigationSnapshot,
  setNavigationLocked,
  storeNavigationPreferences,
  subscribeToNavigation,
} from "@/lib/navigation";
import {
  getServerSidebarCollapsedSnapshot,
  getSidebarCollapsedSnapshot,
  setSidebarCollapsed,
  subscribeToSidebarCollapsed,
} from "@/lib/sidebar-collapse";

export function NavigationSettings() {
  const navigation = useSyncExternalStore(
    subscribeToNavigation,
    getNavigationSnapshot,
    getServerNavigationSnapshot,
  );
  const sidebarCollapsed = useSyncExternalStore(
    subscribeToSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    getServerSidebarCollapsedSnapshot,
  );
  const [notice, setNotice] = useState("");

  function resetNavigation() {
    storeNavigationPreferences(defaultNavigationPreferences());
    setNotice("Navigation is back to its default layout.");
  }

  function unlockNavigation() {
    storeNavigationPreferences(setNavigationLocked(navigation, false));
    setNotice("Navigation editing is unlocked.");
  }

  function lockNavigation() {
    storeNavigationPreferences(setNavigationLocked(navigation, true));
    setNotice("Navigation editing is locked.");
  }

  return (
    <SettingsSection
      id="navigation"
      title="Navigation & sidebar"
      icon={<PanelLeftClose size={17} className="text-muted-foreground" aria-hidden="true" />}
      description="Choose what appears in navigation and how the desktop sidebar starts."
    >
      <div className="space-y-2">
        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border bg-background px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium">Show database pages</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Show pages created for database records in the sidebar, Pages, home, recents, and
              graph.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Show database pages"
            checked={navigation.showDatabasePages}
            onChange={(event) =>
              storeNavigationPreferences({
                ...navigation,
                showDatabasePages: event.target.checked,
              })
            }
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
        </label>

        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border bg-background px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium">Collapse sidebar to an icon rail</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Use the compact desktop sidebar. The mobile bar is unchanged.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Collapse sidebar to an icon rail"
            checked={sidebarCollapsed}
            onChange={(event) => setSidebarCollapsed(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {navigation.locked ? (
          <Button type="button" variant="outline" onClick={unlockNavigation}>
            <Lock size={15} /> Unlock navigation
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => window.dispatchEvent(new Event("open-navigation-editor"))}
          >
            <SlidersHorizontal size={15} /> Edit navigation
          </Button>
        )}
        {!navigation.locked && (
          <Button type="button" variant="outline" onClick={lockNavigation}>
            <Lock size={15} /> Lock navigation
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={resetNavigation}
          disabled={navigation.locked}
          title={navigation.locked ? "Unlock navigation to reset it" : undefined}
        >
          <RotateCcw size={15} /> Reset navigation
        </Button>
      </div>

      {navigation.locked && (
        <p className="mt-3 text-xs text-muted-foreground">
          Unlock navigation to edit or reset it.
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {navigation.sections.length} section{navigation.sections.length === 1 ? "" : "s"} ·{" "}
        {navigation.mobile.length} mobile shortcut{navigation.mobile.length === 1 ? "" : "s"}
        {navigation.locked ? " · locked" : ""}
      </p>
    </SettingsSection>
  );
}
