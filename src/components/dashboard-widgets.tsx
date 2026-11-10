"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronLeft, ChevronRight, LayoutDashboard, Plus, X } from "lucide-react";
import { ChartBars, ChartLine, ChartNotes, ChartPie } from "@/components/database-chart";
import { Button } from "@/components/ui/button";
import { todayKey } from "@/lib/calendar";
import {
  chartDatePresetWindow,
  chartDateSpanLabel,
  chartDateWindow,
  chartOutsideRecordsHref,
  chartRangeRecordsHref,
  parseChartDateBound,
  parseChartDateOffset,
  parseChartDatePreset,
  parseChartType,
  type ChartData,
  type ChartDatePreset,
  type ChartSeries,
  type ChartType,
} from "@/lib/database-chart";
import type { DatabasePropertyType } from "@/lib/database-property";
import type { DatabaseViewType } from "@/lib/database-view";
import { statusToneClass } from "@/lib/status-tone";
import { parseTimelineRange, TIMELINE_RANGES, type TimelineRange } from "@/lib/timeline";
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
  type: DatabaseViewType;
  databaseId: string;
  databaseName: string;
};

type WidgetProperty = { id: string; name: string; type: DatabasePropertyType };
type WidgetRecord = {
  id: string;
  title: string;
  values: Record<string, unknown>;
  pageId: string | null;
};

type WidgetChart = {
  type: ChartType;
  property: { id: string; name: string; type: DatabasePropertyType };
  groupProperty: { id: string; name: string } | null;
  dateProperty: { id: string; name: string; type: DatabasePropertyType } | null;
  dateRange: TimelineRange;
  dateOffset: number;
  dateStart: string | null;
  dateEnd: string | null;
  datePreset: ChartDatePreset | null;
  chart: ChartData;
  series: ChartSeries | null;
};

type WidgetData = {
  view: ViewOption & { config: Record<string, unknown> };
  properties: WidgetProperty[];
  records: WidgetRecord[];
  chart: WidgetChart | null;
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
  // A shape switch applies immediately and is saved back to the shared view,
  // so the database page and every other widget follow the same choice.
  const [chartTypes, setChartTypes] = useState<Record<string, ChartType>>({});
  const [chartPicks, setChartPicks] = useState<
    Record<string, {
      propertyId?: string;
      groupPropertyId?: string;
      datePropertyId?: string;
      dateRange?: TimelineRange;
      dateOffset?: number;
      dateStart?: string | null;
      dateEnd?: string | null;
      datePreset?: ChartDatePreset | null;
    }>
  >({});
  const [chartSaving, setChartSaving] = useState("");
  const [chartError, setChartError] = useState("");

  const requestedIds = widgets.map((widget) => widget.viewId).join(",");

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      setLoadError("");
      try {
        const params = new URLSearchParams({ today: todayKey() });
        if (requestedIds) params.set("viewIds", requestedIds);
        const response = await fetch(`/api/dashboard?${params.toString()}`);
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

  async function changeChartType(item: WidgetData, next: ChartType) {
    if (!item.chart || item.chart.type === next) return;
    setChartTypes((current) => ({ ...current, [item.view.id]: next }));
    setChartSaving(item.view.id);
    setChartError("");
    try {
      const response = await fetch(
        `/api/databases/${item.view.databaseId}/views/${item.view.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: { ...item.view.config, chartType: next },
          }),
        },
      );
      if (!response.ok) throw new Error("Could not save the chart shape.");
      setItems((current) => current.map((candidate) => candidate.view.id === item.view.id
        ? {
            ...candidate,
            view: { ...candidate.view, config: { ...candidate.view.config, chartType: next } },
            chart: candidate.chart ? { ...candidate.chart, type: next } : candidate.chart,
          }
        : candidate));
      setChartTypes((current) => {
        const remaining = { ...current };
        delete remaining[item.view.id];
        return remaining;
      });
    } catch (saveError) {
      setChartTypes((current) => {
        const remaining = { ...current };
        delete remaining[item.view.id];
        return remaining;
      });
      setChartError(
        saveError instanceof Error ? saveError.message : "Could not save the chart shape.",
      );
    } finally {
      setChartSaving("");
    }
  }

  async function changeChartData(
    item: WidgetData,
    patch: {
      chartPropertyId?: string;
      chartGroupPropertyId?: string;
      chartDatePropertyId?: string;
      chartDateRange?: TimelineRange;
      chartDateOffset?: number;
      chartDateStart?: string | null;
      chartDateEnd?: string | null;
      chartDatePreset?: ChartDatePreset | null;
    },
  ) {
    if (!item.chart) return;
    setChartPicks((current) => ({
      ...current,
      [item.view.id]: { ...current[item.view.id], ...patch },
    }));
    setChartSaving(item.view.id);
    setChartError("");
    try {
      const response = await fetch(
        `/api/databases/${item.view.databaseId}/views/${item.view.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: { ...item.view.config, ...patch } }),
        },
      );
      if (!response.ok) throw new Error("Could not save the chart setting.");
      // The chosen property or grouping needs its own chart data, which the
      // dashboard endpoint computes from the view that was just saved.
      const params = new URLSearchParams({ today: todayKey() });
      if (requestedIds) params.set("viewIds", requestedIds);
      const refreshed = await fetch(`/api/dashboard?${params.toString()}`);
      if (!refreshed.ok) throw new Error("Could not update the chart.");
      const data: { views: ViewOption[]; widgets: WidgetData[] } =
        await refreshed.json();
      setViews(data.views);
      setItems(data.widgets);
      setChartPicks((current) => {
        const remaining = { ...current };
        delete remaining[item.view.id];
        return remaining;
      });
    } catch (saveError) {
      setChartPicks((current) => {
        const remaining = { ...current };
        delete remaining[item.view.id];
        return remaining;
      });
      setChartError(
        saveError instanceof Error ? saveError.message : "Could not save the chart setting.",
      );
    } finally {
      setChartSaving("");
    }
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

      {chartError && (
        <p role="alert" className="text-xs text-destructive">{chartError}</p>
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
            const chartType = chartTypes[item.view.id] ?? item.chart?.type ?? "bars";
            const chartProperties = item.properties.filter((property) =>
              property.type === "number" || property.type === "formula" || property.type === "rollup",
            );
            const chartGroupProperties = item.properties.filter(
              (property) => property.type === "select",
            );
            const chartDateProperties = item.properties.filter(
              (property) => property.type === "date",
            );
            const picks = chartPicks[item.view.id];
            const chartPropertyId = picks?.propertyId ?? item.chart?.property.id ?? "";
            const chartGroupPropertyId = picks?.groupPropertyId ?? item.chart?.groupProperty?.id ?? "";
            const chartDatePropertyId = picks?.datePropertyId ?? item.chart?.dateProperty?.id ?? "";
            const chartDateRange = parseTimelineRange(
              picks?.dateRange ?? item.chart?.dateRange ?? item.view.config.chartDateRange,
            );
            const chartDateOffset = parseChartDateOffset(
              picks?.dateOffset ?? item.chart?.dateOffset ?? item.view.config.chartDateOffset,
            );
            const chartDatePreset = parseChartDatePreset(
              picks?.datePreset ?? item.chart?.datePreset ?? item.view.config.chartDatePreset,
            );
            const chartToday = todayKey();
            const chartPresetWindow = chartDatePreset
              ? chartDatePresetWindow(chartToday, chartDatePreset)
              : null;
            const chartDateStart = chartPresetWindow?.from ?? parseChartDateBound(
              picks?.dateStart ?? item.chart?.dateStart ?? item.view.config.chartDateStart,
            ) ?? "";
            const chartDateEnd = chartPresetWindow?.to ?? parseChartDateBound(
              picks?.dateEnd ?? item.chart?.dateEnd ?? item.view.config.chartDateEnd,
            ) ?? "";
            const chartWindow = chartDatePropertyId
              ? chartDateWindow(
                  chartToday,
                  chartDateRange,
                  chartDateOffset,
                  chartDateStart,
                  chartDateEnd,
                  chartDatePreset,
                )
              : null;
            const chartRangeActive = chartDatePreset !== null
              || (chartDateStart !== "" && chartDateEnd !== "");
            const chartRangeLabel = chartDatePreset === "this-month"
              ? "This month"
              : chartDatePreset === "last-month"
                ? "Last month"
                : "Custom range";
            const chartRangeSpan = chartDateStart && chartDateEnd
              ? chartDateSpanLabel(chartDateStart, chartDateEnd)
              : "";
            const chartRangeHref = chartRangeActive && chartDatePropertyId
              ? chartRangeRecordsHref(
                  item.view.databaseId,
                  chartDatePropertyId,
                  chartDateStart,
                  chartDateEnd,
                  undefined,
                  item.view.id,
                  true,
                )
              : "";
            const chartOutsideHref = chartRangeActive && chartDatePropertyId
              ? chartOutsideRecordsHref(
                  item.view.databaseId,
                  chartDatePropertyId,
                  chartDateStart,
                  chartDateEnd,
                  undefined,
                  item.view.id,
                  true,
                )
              : "";

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

                {item.chart ? (
                  <div className="mt-3 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <label className="flex items-center gap-2">
                        Shape
                        <select
                          aria-label={`Chart type for ${item.view.name}`}
                          value={chartType}
                          disabled={chartSaving === item.view.id}
                          onChange={(event) =>
                            void changeChartType(item, parseChartType(event.target.value))
                          }
                          className="rounded-md border bg-background px-1.5 py-1 text-[11px] text-foreground disabled:opacity-50"
                        >
                          <option value="bars">Bars</option>
                          <option value="pie">Pie</option>
                          <option value="line">Line</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2">
                        Value
                        <select
                          aria-label={`Chart value for ${item.view.name}`}
                          value={chartPropertyId}
                          disabled={chartSaving === item.view.id}
                          onChange={(event) =>
                            void changeChartData(item, { chartPropertyId: event.target.value })
                          }
                          className="max-w-32 rounded-md border bg-background px-1.5 py-1 text-[11px] text-foreground disabled:opacity-50"
                        >
                          {chartProperties.map((property) => (
                            <option key={property.id} value={property.id}>{property.name}</option>
                          ))}
                        </select>
                      </label>
                      {chartType !== "line" && (
                        <label className="flex items-center gap-2">
                          Group
                          <select
                            aria-label={`Chart group for ${item.view.name}`}
                            value={chartGroupPropertyId}
                            disabled={chartSaving === item.view.id}
                            onChange={(event) =>
                              void changeChartData(item, { chartGroupPropertyId: event.target.value })
                            }
                            className="max-w-32 rounded-md border bg-background px-1.5 py-1 text-[11px] text-foreground disabled:opacity-50"
                          >
                            <option value="">Each record</option>
                            {chartGroupProperties.map((property) => (
                              <option key={property.id} value={property.id}>{property.name}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      {chartDateProperties.length > 0 && (
                        <label className="flex items-center gap-2">
                          Dates
                          <select
                            aria-label={`Chart dates for ${item.view.name}`}
                            value={chartDatePropertyId}
                            disabled={chartSaving === item.view.id}
                            onChange={(event) =>
                              void changeChartData(item, { chartDatePropertyId: event.target.value })
                            }
                            className="max-w-32 rounded-md border bg-background px-1.5 py-1 text-[11px] text-foreground disabled:opacity-50"
                          >
                            <option value="">View order</option>
                            {chartDateProperties.map((property) => (
                              <option key={property.id} value={property.id}>{property.name}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      {chartDatePropertyId && (
                        <>
                          <label className="flex items-center gap-2">
                            Window
                            <select
                              aria-label={`Chart window for ${item.view.name}`}
                              value={chartDateRange}
                              disabled={chartSaving === item.view.id}
                              onChange={(event) =>
                                void changeChartData(item, {
                                  chartDateRange: parseTimelineRange(event.target.value),
                                  chartDateStart: null,
                                  chartDateEnd: null,
                                  chartDatePreset: null,
                                })
                              }
                              className="max-w-32 rounded-md border bg-background px-1.5 py-1 text-[11px] text-foreground disabled:opacity-50"
                            >
                              {TIMELINE_RANGES.map((value) => (
                                <option key={value} value={value}>Next {value} days</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-1">
                            From
                            <input
                              type="date"
                              aria-label={`Chart range start for ${item.view.name}`}
                              value={chartDateStart}
                              max={chartDateEnd || undefined}
                              disabled={chartSaving === item.view.id}
                              onChange={(event) =>
                                void changeChartData(item, {
                                  chartDateStart: event.target.value || null,
                                  chartDateEnd: chartDateEnd || null,
                                  chartDatePreset: null,
                                })
                              }
                              className="rounded-md border bg-background px-1 py-1 text-[10px] text-foreground disabled:opacity-50"
                            />
                          </label>
                          <label className="flex items-center gap-1">
                            To
                            <input
                              type="date"
                              aria-label={`Chart range end for ${item.view.name}`}
                              value={chartDateEnd}
                              min={chartDateStart || undefined}
                              disabled={chartSaving === item.view.id}
                              onChange={(event) =>
                                void changeChartData(item, {
                                  chartDateStart: chartDateStart || null,
                                  chartDateEnd: event.target.value || null,
                                  chartDatePreset: null,
                                })
                              }
                              className="rounded-md border bg-background px-1 py-1 text-[10px] text-foreground disabled:opacity-50"
                            />
                          </label>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              aria-label={`This month for ${item.view.name}`}
                              aria-pressed={chartDatePreset === "this-month"}
                              disabled={chartSaving === item.view.id}
                              onClick={() =>
                                void changeChartData(item, {
                                  chartDatePreset: "this-month",
                                  chartDateStart: null,
                                  chartDateEnd: null,
                                })
                              }
                              className="rounded-md border bg-background px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                            >
                              This month
                            </button>
                            <button
                              type="button"
                              aria-label={`Last month for ${item.view.name}`}
                              aria-pressed={chartDatePreset === "last-month"}
                              disabled={chartSaving === item.view.id}
                              onClick={() =>
                                void changeChartData(item, {
                                  chartDatePreset: "last-month",
                                  chartDateStart: null,
                                  chartDateEnd: null,
                                })
                              }
                              className="rounded-md border bg-background px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                            >
                              Last month
                            </button>
                          </div>
                        </>
                      )}
                      {chartDatePropertyId && (
                        chartRangeActive ? (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            {chartRangeLabel}{chartRangeSpan ? ` · ${chartRangeSpan}` : ""}
                            {chartRangeHref && item.chart?.series ? (
                              <>
                                {" · "}
                                <Link
                                  href={chartRangeHref}
                                  title="Open the database filtered to these records"
                                  className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  {item.chart.series.inWindow}{" "}
                                  {item.chart.series.inWindow === 1 ? "record" : "records"}
                                </Link>
                                {(item.chart.series.outside ?? 0) > 0 ? (
                                  <>
                                    {" · "}
                                    {chartOutsideHref ? (
                                      <Link
                                        href={chartOutsideHref}
                                        title="Open the database filtered to records outside this date window"
                                        className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      >
                                        {item.chart.series.outside} outside
                                      </Link>
                                    ) : (
                                      <span>{item.chart.series.outside} outside</span>
                                    )}
                                  </>
                                ) : null}
                              </>
                            ) : null}
                            <button
                              type="button"
                              aria-label={`Clear range for ${item.view.name}`}
                              disabled={chartSaving === item.view.id}
                              onClick={() =>
                                void changeChartData(item, {
                                  chartDateStart: null,
                                  chartDateEnd: null,
                                  chartDatePreset: null,
                                })
                              }
                              className="rounded-md border bg-background px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                            >
                              Rolling
                            </button>
                            <button
                              type="button"
                              aria-label={`Clear date window for ${item.view.name}`}
                              title="Clear date window"
                              disabled={chartSaving === item.view.id}
                              onClick={() =>
                                void changeChartData(item, {
                                  chartDatePropertyId: "",
                                  chartDateStart: null,
                                  chartDateEnd: null,
                                  chartDatePreset: null,
                                  chartDateOffset: 0,
                                })
                              }
                              className="rounded-md border bg-background px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                            >
                              Clear
                            </button>
                          </span>
                        ) : (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`Previous window for ${item.view.name}`}
                            title={`Shift back ${chartDateRange} days`}
                            disabled={chartSaving === item.view.id}
                            onClick={() =>
                              void changeChartData(item, {
                                chartDateOffset: parseChartDateOffset(chartDateOffset - chartDateRange),
                              })
                            }
                            className="inline-flex size-6 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40"
                          >
                            <ChevronLeft size={12} aria-hidden="true" />
                          </button>
                          <span className="min-w-16 text-center text-[10px] text-muted-foreground">
                            {chartDateOffset === 0
                              ? "Ends today"
                              : `${Math.abs(chartDateOffset)} days back`}
                          </span>
                          <button
                            type="button"
                            aria-label={`Next window for ${item.view.name}`}
                            title="Shift forward"
                            disabled={chartSaving === item.view.id || chartDateOffset === 0}
                            onClick={() =>
                              void changeChartData(item, {
                                chartDateOffset: parseChartDateOffset(chartDateOffset + chartDateRange),
                              })
                            }
                            className="inline-flex size-6 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40"
                          >
                            <ChevronRight size={12} aria-hidden="true" />
                          </button>
                          {chartDateOffset !== 0 && (
                            <button
                              type="button"
                              aria-label={`Reset ${item.view.name} window to today`}
                              disabled={chartSaving === item.view.id}
                              onClick={() => void changeChartData(item, { chartDateOffset: 0 })}
                              className="rounded-md border bg-background px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                            >
                              Today
                            </button>
                          )}
                        </div>
                        )
                      )}
                    </div>
                    {chartType === "bars" && (
                      <ChartBars
                        databaseId={item.view.databaseId}
                        chart={item.chart.chart}
                        groupProperty={item.chart.groupProperty}
                        sourceViewId={item.view.id}
                        fromDashboard
                        datePropertyId={chartDatePropertyId}
                        dateWindow={chartWindow}
                      />
                    )}
                    {chartType === "pie" && (
                      <ChartPie
                        databaseId={item.view.databaseId}
                        chart={item.chart.chart}
                        groupProperty={item.chart.groupProperty}
                        sourceViewId={item.view.id}
                        fromDashboard
                        datePropertyId={chartDatePropertyId}
                        dateWindow={chartWindow}
                      />
                    )}
                    {chartType === "line" && item.chart.series && (
                      <ChartLine databaseId={item.view.databaseId} series={item.chart.series} />
                    )}
                    <ChartNotes
                      type={chartType}
                      chart={item.chart.chart}
                      series={item.chart.series}
                      propertyName={item.chart.property.name}
                      databaseId={item.view.databaseId}
                      groupPropertyId={item.chart.groupProperty?.id}
                      sourceViewId={item.view.id}
                      fromDashboard
                      datePropertyId={chartDatePropertyId}
                      dateWindow={chartWindow}
                    />
                  </div>
                ) : item.view.type === "chart" ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    This chart needs a Number, Formula, or Rollup property.
                  </p>
                ) : item.records.length === 0 ? (
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
                              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusToneClass(statusValue)}`}
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
