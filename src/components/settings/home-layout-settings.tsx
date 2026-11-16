"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Eye, LayoutDashboard, Lock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/settings-section";
import {
  DASHBOARD_WIDGETS,
  dashboardWidget,
  defaultDashboardLayout,
  getDashboardLayoutSnapshot,
  getServerDashboardLayoutSnapshot,
  setDashboardLocked,
  setDashboardWidgetHidden,
  storeDashboardLayout,
  subscribeToDashboardLayout,
} from "@/lib/dashboard-layout";

export function HomeLayoutSettings() {
  const router = useRouter();
  const layout = useSyncExternalStore(
    subscribeToDashboardLayout,
    getDashboardLayoutSnapshot,
    getServerDashboardLayoutSnapshot,
  );
  const [notice, setNotice] = useState("");
  const visibleWidgets = Math.max(0, DASHBOARD_WIDGETS.length - layout.hidden.length);

  function resetHomeLayout() {
    storeDashboardLayout(defaultDashboardLayout());
    setNotice("Home layout is back to its default order and widths.");
  }

  function toggleHomeLayoutLock() {
    storeDashboardLayout(setDashboardLocked(layout, !layout.locked));
    setNotice(layout.locked ? "Home layout unlocked." : "Home layout locked.");
  }

  return (
    <SettingsSection
      id="home"
      title="Home layout"
      icon={<LayoutDashboard size={17} className="text-muted-foreground" aria-hidden="true" />}
      description="The home page remembers card order, widths, hidden widgets, and its lock in this browser."
    >
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-background px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">
            {visibleWidgets} of {DASHBOARD_WIDGETS.length} widgets visible
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {layout.hidden.length > 0 ? `${layout.hidden.length} hidden` : "No widgets hidden"}
            {" · "}
            {layout.locked ? "layout locked" : "layout editable"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/")}>
            <LayoutDashboard size={15} /> Open home
          </Button>
          <Button type="button" variant="outline" onClick={toggleHomeLayoutLock}>
            <Lock size={15} /> {layout.locked ? "Unlock layout" : "Lock layout"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={resetHomeLayout}
            disabled={layout.locked}
            title={layout.locked ? "Unlock the layout to reset it" : undefined}
          >
            <RotateCcw size={15} /> Reset layout
          </Button>
        </div>
      </div>

      {layout.hidden.length > 0 && (
        <div className="mt-3 rounded-lg border border-dashed bg-background px-3 py-2.5">
          <p className="text-xs font-semibold">Hidden widgets</p>
          {layout.locked ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Unlock the layout to restore hidden widgets.
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {layout.hidden.map((id) => (
                <li key={id}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      storeDashboardLayout(setDashboardWidgetHidden(layout, id, false))
                    }
                  >
                    <Eye size={12} aria-hidden="true" /> Show {dashboardWidget(id).label}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {notice && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Customize card order, widths, and hidden widgets from the home page. Locking here hides
        those editing controls until you unlock it.
      </p>
    </SettingsSection>
  );
}
