"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  chartDateSpanLabel,
  chartDatumRecordsHref,
  chartOutsideGroupRecordsHref,
  chartOutsideRecordsHref,
  chartRangeRecordsHref,
  parseChartDateOffset,
  parseChartType,
  pieData,
  type ChartData,
  type ChartDatePreset,
  type ChartPoint,
  type ChartSeries,
  type ChartType,
} from "@/lib/database-chart";
import {
  parseTimelineRange,
  TIMELINE_RANGES,
  type TimelineRange,
} from "@/lib/timeline";

export type ChartProperty = { id: string; name: string; type: string };
export type ChartGroupProperty = { id: string; name: string };

/** Distinct hues for pie slices; the legend labels every slice in text too. */
const PIE_COLORS = [
  "#4f46e5",
  "#0d9488",
  "#d97706",
  "#e11d48",
  "#0284c7",
  "#7c3aed",
  "#65a30d",
  "#db2777",
  "#0891b2",
  "#b45309",
  "#2563eb",
  "#15803d",
];

function formatValue(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatPercent(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function skippedNote(count: number, propertyName: string) {
  return `${count} ${count === 1 ? "record has" : "records have"} no ${propertyName} value.`;
}

/** Horizontal bars, largest first, each bar linking to the records behind it. */
export function ChartBars({
  databaseId,
  chart,
  groupProperty,
  recordsViewId,
  sourceViewId,
  fromDashboard,
  datePropertyId,
  dateWindow,
  onRecordsOpen,
}: {
  databaseId: string;
  chart: ChartData;
  groupProperty?: ChartGroupProperty | null;
  recordsViewId?: string;
  sourceViewId?: string;
  fromDashboard?: boolean;
  /** Keep a dashboard chart's active date window on every slice link. */
  datePropertyId?: string;
  dateWindow?: { from: string; to: string } | null;
  onRecordsOpen?: () => void;
}) {
  return (
    <ul className="space-y-3">
      {chart.data.map((datum, index) => {
        const width = chart.max > 0
          ? Math.max(2, Math.round((Math.abs(datum.value) / chart.max) * 100))
          : 0;
        const outside = datum.outside ?? 0;

        const recordsHref = chartDatumRecordsHref(databaseId, {
          recordId: datum.recordId,
          groupPropertyId: groupProperty?.id,
          groupLabel: datum.label,
          viewId: recordsViewId,
          fromViewId: sourceViewId,
          fromDashboard,
          rangePropertyId: datePropertyId,
          rangeStart: dateWindow?.from,
          rangeEnd: dateWindow?.to,
        });
        const outsideHref = outside > 0 && groupProperty && datePropertyId && dateWindow
          ? chartOutsideGroupRecordsHref(
              databaseId,
              datePropertyId,
              dateWindow.from,
              dateWindow.to,
              groupProperty.id,
              datum.label,
              recordsViewId,
              sourceViewId,
              fromDashboard,
            )
          : "";

        return (
          <li key={`${datum.recordId ?? datum.label}-${index}`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                {datum.recordId ? (
                  <Link
                    href={`/databases/${databaseId}/records/${datum.recordId}`}
                    className="hover:text-primary hover:underline"
                  >
                    {datum.label}
                  </Link>
                ) : (
                  datum.label
                )}
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {formatValue(datum.value)}
                {outside > 0 ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}·{" "}
                    {outsideHref ? (
                      <Link
                        href={outsideHref}
                        onClick={onRecordsOpen}
                        aria-label={`Open database filtered to ${datum.label} ${outside === 1 ? "record" : "records"} outside this date window`}
                        title={`Open database filtered to ${datum.label} records outside this date window`}
                        className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {outside} outside
                      </Link>
                    ) : (
                      `${outside} outside`
                    )}
                  </span>
                ) : null}
              </span>
            </div>
            <Link
              href={recordsHref}
              onClick={onRecordsOpen}
              aria-label={`Open database filtered to ${datum.label}`}
              title={`Open the database filtered to ${datum.count === 1 ? "this record" : `${datum.count} records`}`}
              className="mt-1 flex h-4 items-center rounded-full bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="h-2 rounded-full bg-brand" style={{ width: `${width}%` }} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function piePoint(angle: number, radius: number): [number, number] {
  const radians = ((angle - 90) * Math.PI) / 180;
  return [50 + radius * Math.cos(radians), 50 + radius * Math.sin(radians)];
}

/** A donut segment from one percentage of the circle to the next. */
function pieSlicePath(startPercent: number, endPercent: number): string {
  const outer = 48;
  const inner = 27;
  const startAngle = startPercent * 3.6;
  const endAngle = endPercent * 3.6;
  const [x1, y1] = piePoint(startAngle, outer);
  const [x2, y2] = piePoint(endAngle, outer);
  const [x3, y3] = piePoint(endAngle, inner);
  const [x4, y4] = piePoint(startAngle, inner);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${outer} ${outer} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${largeArc} 0 ${x4} ${y4} Z`;
}

/** Share of the positive total, with an explicit legend instead of colour alone. */
export function ChartPie({
  databaseId,
  chart,
  groupProperty,
  recordsViewId,
  sourceViewId,
  fromDashboard,
  datePropertyId,
  dateWindow,
  onRecordsOpen,
}: {
  databaseId: string;
  chart: ChartData;
  groupProperty?: ChartGroupProperty | null;
  recordsViewId?: string;
  sourceViewId?: string;
  fromDashboard?: boolean;
  /** Keep a dashboard chart's active date window on every slice link. */
  datePropertyId?: string;
  dateWindow?: { from: string; to: string } | null;
  onRecordsOpen?: () => void;
}) {
  const pie = pieData(chart.data);

  if (pie.slices.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        A pie needs a value above zero.{" "}
        {chart.outsideOnlyGroups.length > 0
          ? "No record inside this date window has one."
          : "Everything charted here is zero or negative."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-6">
        <svg
          viewBox="0 0 100 100"
          role="group"
          aria-label="Pie slices"
          className="size-40 shrink-0"
        >
          {pie.slices.map((slice, index) => {
            const start = pie.slices
              .slice(0, index)
              .reduce((sum, entry) => sum + entry.percent, 0);
            const recordsHref = chartDatumRecordsHref(databaseId, {
              recordId: slice.recordId,
              groupPropertyId: groupProperty?.id,
              groupLabel: slice.label,
              viewId: recordsViewId,
              fromViewId: sourceViewId,
              fromDashboard,
              rangePropertyId: datePropertyId,
              rangeStart: dateWindow?.from,
              rangeEnd: dateWindow?.to,
            });
            const label = `Open database filtered to ${slice.label}`;
            return (
              <Link
                key={`${slice.recordId ?? slice.label}-${index}`}
                href={recordsHref}
                onClick={onRecordsOpen}
                aria-label={label}
              >
                {slice.percent >= 99.999 ? (
                  <circle
                    cx="50"
                    cy="50"
                    r="37.5"
                    fill="none"
                    stroke={PIE_COLORS[index % PIE_COLORS.length]}
                    strokeWidth="21"
                    className="transition-opacity hover:opacity-80"
                  />
                ) : (
                  <path
                    d={pieSlicePath(start, start + slice.percent)}
                    fill={PIE_COLORS[index % PIE_COLORS.length]}
                    className="transition-opacity hover:opacity-80"
                  />
                )}
              </Link>
            );
          })}
        </svg>
        <ul className="min-w-0 flex-1 space-y-2 text-sm">
          {pie.slices.map((slice, index) => {
            const outsideHref = slice.outside > 0
              && groupProperty
              && datePropertyId
              && dateWindow
              ? chartOutsideGroupRecordsHref(
                  databaseId,
                  datePropertyId,
                  dateWindow.from,
                  dateWindow.to,
                  groupProperty.id,
                  slice.label,
                  recordsViewId,
                  sourceViewId,
                  fromDashboard,
                )
              : "";
            return (
              <li key={`${slice.recordId ?? slice.label}-${index}`} className="flex items-baseline gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 self-center rounded-full"
                  style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {slice.recordId ? (
                    <Link
                      href={`/databases/${databaseId}/records/${slice.recordId}`}
                      className="hover:text-primary hover:underline"
                    >
                      {slice.label}
                    </Link>
                  ) : (
                    slice.label
                  )}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatPercent(slice.percent)}% · {formatValue(slice.value)}
                  {slice.outside > 0 ? (
                    <>
                      {" · "}
                      {outsideHref ? (
                        <Link
                          href={outsideHref}
                          onClick={onRecordsOpen}
                          aria-label={`Open database filtered to ${slice.label} ${slice.outside === 1 ? "record" : "records"} outside this date window`}
                          title={`Open database filtered to ${slice.label} records outside this date window`}
                          className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {slice.outside} outside
                        </Link>
                      ) : (
                        `${slice.outside} outside`
                      )}
                    </>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {pie.excluded > 0 && (
        <p className="text-xs text-muted-foreground">
          {pie.excluded} {pie.excluded === 1 ? "value is" : "values are"} zero or negative,
          so the pie leaves {pie.excluded === 1 ? "it" : "them"} out.
        </p>
      )}
    </div>
  );
}

/**
 * A line over the view's record order, or over a chosen date property so the
 * spacing shows real time. Either way it carries a readable value list.
 */
export function ChartLine({
  databaseId,
  series,
}: {
  databaseId: string;
  series: ChartSeries;
}) {
  if (series.points.length === 0) return null;

  const span = series.max - series.min || 1;
  const fromMs = series.from ? Date.parse(`${series.from}T00:00:00Z`) : Number.NaN;
  const toMs = series.to ? Date.parse(`${series.to}T00:00:00Z`) : Number.NaN;
  const dated = series.points.every((point) => typeof point.date === "string")
    && Number.isFinite(fromMs)
    && Number.isFinite(toMs);
  const xFor = (point: ChartPoint, index: number) => {
    if (!dated || !point.date) {
      return series.points.length > 1 ? (index / (series.points.length - 1)) * 100 : 50;
    }
    if (fromMs === toMs) return 50;
    return ((Date.parse(`${point.date}T00:00:00Z`) - fromMs) / (toMs - fromMs)) * 100;
  };
  const yFor = (value: number) => (1 - (value - series.min) / span) * 100;

  return (
    <div className="space-y-2">
      <div className="relative mx-3 my-4 h-36">
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          {series.min < 0 && series.max > 0 && (
            <line
              x1="0"
              x2="100"
              y1={yFor(0)}
              y2={yFor(0)}
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {series.points.length > 1 && (
            <polyline
              points={series.points.map((point, index) => `${xFor(point, index)},${yFor(point.value)}`).join(" ")}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {series.points.map((point, index) => (
          <span
            key={point.recordId}
            aria-hidden="true"
            title={`${point.date ? `${formatDateLabel(point.date)} · ` : ""}${point.label}: ${formatValue(point.value)}`}
            className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand"
            style={{ left: `${xFor(point, index)}%`, top: `${yFor(point.value)}%` }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Low {formatValue(series.min)}</span>
        <span>{series.points.length} {series.points.length === 1 ? "point" : "points"}</span>
        <span>High {formatValue(series.max)}</span>
      </div>
      {dated && series.from && series.to && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{formatDateLabel(series.from)}</span>
          <span>{series.undated ? `${series.undated} undated` : ""}</span>
          <span>{formatDateLabel(series.to)}</span>
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Show {series.points.length} {series.points.length === 1 ? "value" : "values"}
        </summary>
        <ol className="mt-2 space-y-1">
          {series.points.map((point) => (
            <li key={point.recordId} className="flex items-baseline justify-between gap-3">
              <Link
                href={`/databases/${databaseId}/records/${point.recordId}`}
                className="min-w-0 flex-1 truncate hover:text-primary hover:underline"
              >
                {point.label}
              </Link>
              {point.date && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDateLabel(point.date)}
                </span>
              )}
              <span className="shrink-0 tabular-nums">{formatValue(point.value)}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

/** Counts every shape leaves out, kept in one place for page and widget use. */
export function ChartNotes({
  type,
  chart,
  series,
  propertyName,
  databaseId,
  groupPropertyId,
  recordsViewId,
  sourceViewId,
  fromDashboard,
  datePropertyId,
  dateWindow,
  onRecordsOpen,
}: {
  type: ChartType;
  chart: ChartData | null;
  series: ChartSeries | null;
  propertyName: string;
  databaseId: string;
  groupPropertyId?: string | null;
  recordsViewId?: string;
  sourceViewId?: string;
  fromDashboard?: boolean;
  datePropertyId?: string;
  dateWindow?: { from: string; to: string } | null;
  onRecordsOpen?: () => void;
}) {
  return (
    <>
      {type === "bars" && chart && chart.hidden > 0 && (
        <p className="text-xs text-muted-foreground">
          {chart.hidden} more {chart.hidden === 1 ? "record is" : "records are"} not shown.
        </p>
      )}
      {type === "bars" && chart && chart.skipped > 0 && (
        <p className="text-xs text-muted-foreground">
          {skippedNote(chart.skipped, propertyName)}
        </p>
      )}
      {type === "pie" && chart && chart.hidden > 0 && (
        <p className="text-xs text-muted-foreground">
          {chart.hidden} more {chart.hidden === 1 ? "record is" : "records are"} not shown.
        </p>
      )}
      {type === "pie" && chart && chart.skipped > 0 && (
        <p className="text-xs text-muted-foreground">
          {skippedNote(chart.skipped, propertyName)}
        </p>
      )}
      {type !== "line" && chart && chart.outsideOnlyGroups.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Only outside this window:{" "}
          {chart.outsideOnlyGroups.map((group, index) => {
            const href = groupPropertyId && datePropertyId && dateWindow
              ? chartOutsideGroupRecordsHref(
                  databaseId,
                  datePropertyId,
                  dateWindow.from,
                  dateWindow.to,
                  groupPropertyId,
                  group.label,
                  recordsViewId,
                  sourceViewId,
                  fromDashboard,
                )
              : "";
            return (
              <span key={group.label}>
                {index > 0 ? ", " : ""}
                {href ? (
                  <Link
                    href={href}
                    onClick={onRecordsOpen}
                    title="Open the database filtered to this group's excluded records"
                    className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {group.label}
                  </Link>
                ) : (
                  group.label
                )}{" "}
                ({group.count})
              </span>
            );
          })}
          .
        </p>
      )}
      {type === "line" && series && (series.outside ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          {series.outside} {series.outside === 1 ? "record falls" : "records fall"} outside this
          date window.
        </p>
      )}
      {type === "line" && series && (series.undated ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          {series.undated} {series.undated === 1 ? "record has" : "records have"} no date
          and {series.undated === 1 ? "is" : "are"} not plotted.
        </p>
      )}
      {type === "line" && series && series.hidden > 0 && (
        <p className="text-xs text-muted-foreground">
          {series.hidden} more {series.hidden === 1 ? "record is" : "records are"} not plotted.
        </p>
      )}
      {type === "line" && series && series.skipped > 0 && (
        <p className="text-xs text-muted-foreground">
          {skippedNote(series.skipped, propertyName)}
        </p>
      )}
    </>
  );
}

/**
 * A chart over one numeric property. Every shape carries its labels and values
 * as text, so it stays readable without relying on colour: bars for magnitude,
 * a pie for share of total, and a line that follows the view's record order.
 */
export function DatabaseChart({
  databaseId,
  rangeViewId,
  sourceViewId,
  onRangeOpen,
  chart,
  series,
  properties,
  groupProperties,
  dateProperties,
  propertyId,
  groupPropertyId,
  datePropertyId,
  dateRange,
  dateOffset,
  dateStart,
  dateEnd,
  datePreset,
  type,
  onPropertyChange,
  onGroupChange,
  onDatePropertyChange,
  onDateRangeChange,
  onDateOffsetChange,
  onDateChange,
  onDatePresetChange,
  onDateWindowClear,
  onTypeChange,
}: {
  databaseId: string;
  /** A records view to open when the range count is clicked. */
  rangeViewId?: string;
  /** The chart view that opened the database, for the return path. */
  sourceViewId?: string;
  onRangeOpen?: () => void;
  chart: ChartData | null;
  series: ChartSeries | null;
  properties: ChartProperty[];
  groupProperties: ChartProperty[];
  dateProperties: ChartProperty[];
  propertyId: string;
  groupPropertyId: string;
  datePropertyId: string;
  dateRange: TimelineRange;
  dateOffset: number;
  dateStart: string;
  dateEnd: string;
  datePreset: ChartDatePreset | null;
  type: ChartType;
  onPropertyChange: (propertyId: string) => void;
  onGroupChange: (propertyId: string) => void;
  onDatePropertyChange: (propertyId: string) => void;
  onDateRangeChange: (range: TimelineRange) => void;
  onDateOffsetChange: (offset: number) => void;
  onDateChange: (start: string, end: string) => void;
  onDatePresetChange: (preset: ChartDatePreset) => void;
  onDateWindowClear: () => void;
  onTypeChange: (type: ChartType) => void;
}) {
  const valueProperty = properties.find((property) => property.id === propertyId) ?? properties[0];
  const groupProperty = groupProperties.find((property) => property.id === groupPropertyId) ?? null;
  const dateProperty = dateProperties.find((property) => property.id === datePropertyId);
  const rangeActive = datePreset !== null || Boolean(dateStart && dateEnd);
  const rangeLabel = datePreset === "this-month"
    ? "This month"
    : datePreset === "last-month"
      ? "Last month"
      : "Custom range";
  const rangeSpan = dateStart && dateEnd ? chartDateSpanLabel(dateStart, dateEnd) : "";
  const rangeRecordsHref = series && dateProperty && rangeSpan
    ? chartRangeRecordsHref(
        databaseId,
        dateProperty.id,
        dateStart,
        dateEnd,
        rangeViewId,
        sourceViewId,
      )
    : "";
  const outsideRecordsHref = series && dateProperty && rangeSpan && (series.outside ?? 0) > 0
    ? chartOutsideRecordsHref(
        databaseId,
        dateProperty.id,
        dateStart,
        dateEnd,
        rangeViewId,
        sourceViewId,
      )
    : "";

  if (!valueProperty) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        This chart needs a Number, Formula, or Rollup property. Add one, then create a
        new chart view.
      </p>
    );
  }

  const line = type === "line" ? series : null;
  const isEmpty = type === "line"
    ? !line || line.points.length === 0
    : !chart || chart.data.length === 0;
  const outsideOnly = type !== "line" && (chart?.outsideOnlyGroups.length ?? 0) > 0;
  const count = type === "line"
    ? line?.points.length ?? 0
    : type === "pie"
      ? chart
        ? pieData(chart.data).slices.length
        : 0
      : chart?.data.length ?? 0;
  const countLabel = type === "line" ? "point" : type === "pie" ? "slice" : "bar";

  return (
    <section className="space-y-4" aria-label={`${valueProperty.name} chart`}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Chart
          <select
            aria-label="Chart type"
            value={type}
            onChange={(event) => onTypeChange(parseChartType(event.target.value))}
            className="rounded-md border bg-background px-2 py-1.5"
          >
            <option value="bars">Bars</option>
            <option value="pie">Pie</option>
            <option value="line">Line</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Value
          <select
            aria-label="Chart value property"
            value={valueProperty.id}
            onChange={(event) => onPropertyChange(event.target.value)}
            className="rounded-md border bg-background px-2 py-1.5"
          >
            {properties.map((property) => (
              <option key={property.id} value={property.id}>{property.name}</option>
            ))}
          </select>
        </label>
        {type !== "line" && (
          <label className="flex items-center gap-2">
            Group by
            <select
              aria-label="Chart group property"
              value={groupPropertyId}
              onChange={(event) => onGroupChange(event.target.value)}
              className="rounded-md border bg-background px-2 py-1.5"
            >
              <option value="">Each record</option>
              {groupProperties.map((property) => (
                <option key={property.id} value={property.id}>{property.name}</option>
              ))}
            </select>
          </label>
        )}
        {type === "line" && dateProperties.length > 0 && (
          <label className="flex items-center gap-2">
            Dates
            <select
              aria-label="Chart date property"
              value={dateProperty?.id ?? ""}
              onChange={(event) => onDatePropertyChange(event.target.value)}
              className="rounded-md border bg-background px-2 py-1.5"
            >
              <option value="">View order</option>
              {dateProperties.map((property) => (
                <option key={property.id} value={property.id}>{property.name}</option>
              ))}
            </select>
          </label>
        )}
        {type === "line" && dateProperty && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              Window
              <select
                aria-label="Chart date window"
                value={dateRange}
                onChange={(event) => onDateRangeChange(parseTimelineRange(event.target.value))}
                className="rounded-md border bg-background px-2 py-1.5"
              >
                {TIMELINE_RANGES.map((value) => (
                  <option key={value} value={value}>Next {value} days</option>
                ))}
              </select>
            </label>
            {rangeActive ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {rangeLabel}{rangeSpan ? ` · ${rangeSpan}` : ""}
                {series ? (
                  <>
                    {" · "}
                    {rangeRecordsHref ? (
                      <Link
                        href={rangeRecordsHref}
                        onClick={onRangeOpen}
                        title="Open the database filtered to these records"
                        className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {series.inWindow} {series.inWindow === 1 ? "record" : "records"}
                      </Link>
                    ) : (
                      <span>
                        {series.inWindow} {series.inWindow === 1 ? "record" : "records"}
                      </span>
                    )}
                    {(series.outside ?? 0) > 0 ? (
                      <>
                        {" · "}
                        {outsideRecordsHref ? (
                          <Link
                            href={outsideRecordsHref}
                            onClick={onRangeOpen}
                            title="Open the database filtered to records outside this date window"
                            className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {series.outside} outside
                          </Link>
                        ) : (
                          <span>{series.outside} outside</span>
                        )}
                      </>
                    ) : null}
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => onDateChange("", "")}
                  className="rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Rolling
                </button>
                <button
                  type="button"
                  aria-label="Clear date window"
                  title="Clear date window"
                  onClick={onDateWindowClear}
                  className="rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              </span>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous date window"
                  title={`Shift back ${dateRange} days`}
                  onClick={() => onDateOffsetChange(parseChartDateOffset(dateOffset - dateRange))}
                  className="inline-flex size-7 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft size={14} aria-hidden="true" />
                </button>
                <span className="min-w-20 text-center text-xs text-muted-foreground">
                  {dateOffset === 0 ? "Ends today" : `${Math.abs(dateOffset)} days back`}
                </span>
                <button
                  type="button"
                  aria-label="Next date window"
                  title="Shift forward"
                  disabled={dateOffset === 0}
                  onClick={() => onDateOffsetChange(parseChartDateOffset(dateOffset + dateRange))}
                  className="inline-flex size-7 items-center justify-center rounded-md border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
                {dateOffset !== 0 && (
                  <button
                    type="button"
                    onClick={() => onDateOffsetChange(0)}
                    className="rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Today
                  </button>
                )}
              </div>
            )}
            <label className="flex items-center gap-2">
              From
              <input
                type="date"
                aria-label="Chart range start"
                value={dateStart}
                max={dateEnd || undefined}
                onChange={(event) => onDateChange(event.target.value, dateEnd)}
                className="rounded-md border bg-background px-2 py-1.5"
              />
            </label>
            <label className="flex items-center gap-2">
              To
              <input
                type="date"
                aria-label="Chart range end"
                value={dateEnd}
                min={dateStart || undefined}
                onChange={(event) => onDateChange(dateStart, event.target.value)}
                className="rounded-md border bg-background px-2 py-1.5"
              />
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={datePreset === "this-month"}
                onClick={() => onDatePresetChange("this-month")}
                className={`rounded-md border px-2 py-1 text-xs ${
                  datePreset === "this-month"
                    ? "bg-muted text-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                This month
              </button>
              <button
                type="button"
                aria-pressed={datePreset === "last-month"}
                onClick={() => onDatePresetChange("last-month")}
                className={`rounded-md border px-2 py-1 text-xs ${
                  datePreset === "last-month"
                    ? "bg-muted text-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                Last month
              </button>
            </div>
          </div>
        )}
        {count > 0 && (
          <span className="text-xs text-muted-foreground">
            {count} {count === 1 ? countLabel : `${countLabel}s`}
          </span>
        )}
      </div>

      {isEmpty ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {outsideOnly
            ? "No values fall inside this date window."
            : `No numeric values yet. Fill ${valueProperty.name} on a record to chart it.`}
        </p>
      ) : type === "pie" && chart ? (
        <ChartPie
          databaseId={databaseId}
          chart={chart}
          groupProperty={groupProperty}
          recordsViewId={rangeViewId}
          sourceViewId={sourceViewId}
          onRecordsOpen={onRangeOpen}
        />
      ) : type === "line" && line ? (
        <ChartLine databaseId={databaseId} series={line} />
      ) : chart ? (
        <ChartBars
          databaseId={databaseId}
          chart={chart}
          groupProperty={groupProperty}
          recordsViewId={rangeViewId}
          sourceViewId={sourceViewId}
          onRecordsOpen={onRangeOpen}
        />
      ) : null}

      <ChartNotes
        type={type}
        chart={chart}
        series={line}
        propertyName={valueProperty.name}
        databaseId={databaseId}
        groupPropertyId={groupProperty?.id}
        recordsViewId={rangeViewId}
        sourceViewId={sourceViewId}
        datePropertyId={dateProperty?.id}
        dateWindow={dateStart && dateEnd ? { from: dateStart, to: dateEnd } : null}
        onRecordsOpen={onRangeOpen}
      />
    </section>
  );
}
