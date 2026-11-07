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

/**
 * Status is colour: the same select values used by a database view render as a
 * pill, so a short record list scans without reading every word.
 */
const STATUS_TONES: { pattern: RegExp; className: string }[] = [
  {
    pattern: /^(done|complete|completed|read|finished|shipped|paid)$/i,
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  {
    pattern: /(in progress|in review|doing|active|reading|watching|playing|started)/i,
    className:
      "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
  },
  {
    pattern: /(blocked|waiting|on hold|paused|stuck)/i,
    className:
      "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  },
  {
    pattern: /(to review|needs review|overdue|dropped|abandoned)/i,
    className: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  },
  {
    pattern: /(planned|backlog|todo|queued|idea|someday|not started)/i,
    className: "bg-muted text-muted-foreground",
  },
];

function statusTone(value: string): string {
  return (
    STATUS_TONES.find((tone) => tone.pattern.test(value))?.className ??
    "bg-muted text-muted-foreground"
  );
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
        const query = requestedIds
          ? `?viewIds=${encodeURIComponent(requestedIds)}`
          : "";
        const response = await fetch(`/api/dashboard${query}`);
        if (!response.ok) throw new Error("Could not load dashboard widgets.");
        const data: { views: ViewOption[]; widgets: WidgetData[] } =
          await response.json();
        if (!cancelled) {
          setViews(data.views);
          setItems(data.widgets);
        }
      } catch (loadFailure) {
        if (!cancelled) {
          setLoadError(
            loadFailure instanceof Error
              ? loadFailure.message
              : "Could not load dashboard widgets.",
          );
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
    storeDashboardWidgets(
      addWidget(widgets, { viewId: view.id, databaseId: view.databaseId }),
    );
    setPickerValue("");
  }

  const availableViews = views.filter(
    (view) => !widgets.some((widget) => widget.viewId === view.id),
  );
  const itemsByView = new Map(items.map((item) => [item.view.id, item]));

  return (
    <section className="space-y-3" aria-labelledby="pinned-views-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="pinned-views-heading"
          className="text-sm font-semibold tracking-tight"
        >
          Pinned views
        </h2>
        <Link
          href="/databases"
          className="text-xs text-muted-foreground transition-colors hover:text-brand"
        >
          Manage
        </Link>
      </div>

      {availableViews.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="dashboard-widget-picker">
            Saved view to pin
          </label>
          <select
            id="dashboard-widget-picker"
            value={pickerValue}
            onChange={(event) => setPickerValue(event.target.value)}
            disabled={availableViews.length === 0}
            className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 text-xs"
          >
            <option value="">Choose a saved view…</option>
            {availableViews.map((view) => (
              <option key={view.id} value={view.id}>
                {view.databaseName} — {view.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={addSelectedWidget}
            disabled={!pickerValue || widgets.length >= DASHBOARD_WIDGET_LIMIT}
          >
            <Plus size={14} aria-hidden="true" /> Pin
          </Button>
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-card p-4"
        >
          <p className="text-sm text-destructive">{loadError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRetryKey((current) => current + 1)}
          >
            Try again
          </Button>
        </div>
      )}

      {loading ? (
        <div
          role="status"
          aria-label="Loading dashboard widgets"
          className="grid gap-3"
        >
          {Array.from({ length: Math.max(1, widgets.length) }, (_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
      ) : widgets.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-6 text-center">
          <LayoutDashboard className="mx-auto text-muted-foreground" size={20} />
          <p className="mt-2 text-sm font-medium">No pinned views yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pin a saved database view to keep its records here.
          </p>
          {views.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => router.push("/databases")}
            >
              Open databases
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {widgets.map((widget) => {
            const item = itemsByView.get(widget.viewId);
            if (!item) {
              return (
                <article
                  key={widget.viewId}
                  className="rounded-xl border border-dashed bg-card p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">
                      This view is no longer available
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        storeDashboardWidgets(removeWidget(widgets, widget.viewId))
                      }
                      aria-label="Remove missing dashboard widget"
                      title="Remove widget"
                      className="size-7"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    It may have been deleted with its database. Remove it to tidy
                    this dashboard.
                  </p>
                </article>
              );
            }

            const datePropertyId =
              typeof item.view.config.datePropertyId === "string"
                ? item.view.config.datePropertyId
                : "";
            const dateProperty = item.properties.find(
              (property) => property.id === datePropertyId,
            );
            const selectProperty = item.properties.find(
              (property) => property.type === "select",
            );

            return (
              <article
                key={widget.viewId}
                className="flex flex-col rounded-xl border bg-card p-3.5"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold tracking-tight">
                      {item.view.name}
                    </h3>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {item.view.databaseName} · database
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      storeDashboardWidgets(removeWidget(widgets, widget.viewId))
                    }
                    aria-label={`Remove ${item.view.name} widget`}
                    title="Remove widget"
                    className="size-7 text-muted-foreground"
                  >
                    <X size={14} />
                  </Button>
                </div>

                {item.records.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No records match this view.
                  </p>
                ) : (
                  <ul className="mt-2">
                    {item.records.map((record) => {
                      const statusValue = selectProperty
                        ? displayValue(record.values[selectProperty.id])
                        : "";
                      const dateValue = dateProperty
                        ? formatDate(record.values[dateProperty.id])
                        : "";

                      return (
                        <li
                          key={record.id}
                          className="flex min-w-0 items-center gap-2 border-b py-1.5 last:border-b-0"
                        >
                          <Link
                            href={`/databases/${item.view.databaseId}/records/${record.id}`}
                            className="min-w-0 flex-1 truncate text-xs font-medium transition-colors hover:text-brand hover:underline"
                          >
                            {record.title || "Untitled"}
                          </Link>
                          {statusValue && (
                            <span
                              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusTone(statusValue)}`}
                            >
                              <span className="size-1 rounded-full bg-current" />
                              {statusValue}
                            </span>
                          )}
                          {dateValue && (
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              {dateValue}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                <Link
                  href={`/databases/${item.view.databaseId}?view=${item.view.id}`}
                  className="mt-2 inline-flex items-center gap-1 border-t pt-2 text-[11px] font-medium text-brand hover:underline"
                >
                  View all {item.total}{" "}
                  {item.total === 1 ? "record" : "records"}{" "}
                  <ArrowRight size={11} aria-hidden="true" />
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
