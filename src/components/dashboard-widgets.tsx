"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LayoutDashboard, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addWidget,
  DASHBOARD_WIDGET_LIMIT,
  getDashboardWidgetsSnapshot,
  getEmptyDashboardWidgetsSnapshot,
  removeWidget,
  storeDashboardWidgets,
  subscribeToDashboardWidgets,
} from "@/lib/dashboard";

type ViewOption = {
  id: string;
  name: string;
  type: string;
  databaseId: string;
  databaseName: string;
};

type WidgetProperty = { id: string; name: string; type: string };
type WidgetRecord = {
  id: string;
  title: string;
  values: Record<string, unknown>;
  pageId: string | null;
};

type WidgetData = {
  view: ViewOption & { config: Record<string, unknown> };
  properties: WidgetProperty[];
  records: WidgetRecord[];
  total: number;
};

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatDate(value: unknown): string {
  const text = displayValue(value);
  if (!text) return "";
  const date = new Date(`${text.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function DashboardWidgets() {
  const router = useRouter();
  const widgets = useSyncExternalStore(
    subscribeToDashboardWidgets,
    getDashboardWidgetsSnapshot,
    getEmptyDashboardWidgetsSnapshot,
  );

  const [views, setViews] = useState<ViewOption[]>([]);
  const [items, setItems] = useState<WidgetData[]>([]);
  const [pickerValue, setPickerValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  const requestedIds = widgets.map((widget) => widget.viewId).join(",");

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      setLoadError("");
      try {
        const query = requestedIds ? `?viewIds=${encodeURIComponent(requestedIds)}` : "";
        const response = await fetch(`/api/dashboard${query}`);
        if (!response.ok) throw new Error("Could not load dashboard widgets.");
        const data: { views: ViewOption[]; widgets: WidgetData[] } = await response.json();
        if (!cancelled) {
          setViews(data.views);
          setItems(data.widgets);
        }
      } catch (loadFailure) {
        if (!cancelled) {
          setLoadError(loadFailure instanceof Error ? loadFailure.message : "Could not load dashboard widgets.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [requestedIds, retryKey]);

  function addSelectedWidget() {
    const view = views.find((candidate) => candidate.id === pickerValue);
    if (!view) return;
    storeDashboardWidgets(addWidget(widgets, { viewId: view.id, databaseId: view.databaseId }));
    setPickerValue("");
  }

  const availableViews = views.filter((view) => !widgets.some((widget) => widget.viewId === view.id));
  const itemsByView = new Map(items.map((item) => [item.view.id, item]));

  return (
    <section className="space-y-4" aria-labelledby="dashboard-widgets-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <LayoutDashboard size={17} className="text-muted-foreground" aria-hidden="true" />
          <div>
            <h2 id="dashboard-widgets-heading" className="text-xl font-semibold tracking-tight">
              Dashboard
            </h2>
            <p className="text-xs text-muted-foreground">Live previews of saved database views.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="dashboard-widget-picker">Saved view to pin</label>
          <select
            id="dashboard-widget-picker"
            value={pickerValue}
            onChange={(event) => setPickerValue(event.target.value)}
            disabled={availableViews.length === 0}
            className="max-w-64 rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">
              {views.length === 0 ? "No saved views yet" : availableViews.length === 0 ? "All views pinned" : "Choose a saved view…"}
            </option>
            {availableViews.map((view) => (
              <option key={view.id} value={view.id}>
                {view.databaseName} — {view.name}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" variant="outline" onClick={addSelectedWidget} disabled={!pickerValue || widgets.length >= DASHBOARD_WIDGET_LIMIT}>
            <Plus size={15} /> Add widget
          </Button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-card p-4">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setRetryKey((current) => current + 1)}>Try again</Button>
        </div>
      )}

      {loading ? (
        <div role="status" aria-label="Loading dashboard widgets" className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: Math.max(1, widgets.length) }, (_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
      ) : widgets.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center">
          <LayoutDashboard className="mx-auto text-muted-foreground" size={22} />
          <p className="mt-3 font-medium">Pin a saved view</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a database view above to keep its records on the home page. Filters and sorts saved on the view apply here too.
          </p>
          {views.length === 0 && (
            <Button variant="outline" className="mt-4" onClick={() => router.push("/databases")}>
              Open databases
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {widgets.map((widget) => {
            const item = itemsByView.get(widget.viewId);
            if (!item) {
              return (
                <article key={widget.viewId} className="rounded-xl border border-dashed bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">This view is no longer available</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => storeDashboardWidgets(removeWidget(widgets, widget.viewId))}
                      aria-label="Remove missing dashboard widget"
                      title="Remove widget"
                    >
                      <X size={15} />
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">It may have been deleted with its database. Remove it to tidy this dashboard.</p>
                </article>
              );
            }

            const datePropertyId = typeof item.view.config.datePropertyId === "string" ? item.view.config.datePropertyId : "";
            const summaryProperties = item.properties
              .filter((property) => property.type !== "relation" && property.type !== "rollup" && property.type !== "formula")
              .slice(0, 3);

            return (
              <article key={widget.viewId} className="flex min-h-40 flex-col rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-medium tracking-tight">{item.view.name}</h3>
                    <p className="truncate text-xs text-muted-foreground">{item.view.databaseName}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => storeDashboardWidgets(removeWidget(widgets, widget.viewId))}
                    aria-label={`Remove ${item.view.name} widget`}
                    title="Remove widget"
                  >
                    <X size={15} />
                  </Button>
                </div>

                {item.records.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">No records match this view.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {item.records.map((record) => {
                      const dateValue = item.properties.find((property) => property.id === datePropertyId);
                      const meta = [
                        dateValue ? formatDate(record.values[dateValue.id]) : "",
                        ...summaryProperties
                          .filter((property) => property.id !== datePropertyId)
                          .map((property) => displayValue(record.values[property.id]))
                          .filter(Boolean)
                          .slice(0, 1),
                      ].filter(Boolean);

                      return (
                        <li key={record.id} className="min-w-0">
                          {record.pageId ? (
                            <Link href={`/pages/${record.pageId}`} className="block truncate text-sm font-medium hover:text-primary hover:underline">
                              {record.title || "Untitled"}
                            </Link>
                          ) : (
                            <span className="block truncate text-sm font-medium">{record.title || "Untitled"}</span>
                          )}
                          {meta.length > 0 && (
                            <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                <Link
                  href={`/databases/${item.view.databaseId}?view=${item.view.id}`}
                  className="mt-auto inline-flex items-center gap-1 pt-3 text-xs text-primary hover:underline"
                >
                  View all {item.total} {item.total === 1 ? "record" : "records"} <ArrowRight size={13} />
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
