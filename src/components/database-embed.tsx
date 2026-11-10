"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Database, ExternalLink, Eye, EyeOff, Trash2, Upload } from "lucide-react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { AttachmentFileLink } from "@/components/attachment-preview";
import { DatabaseChart } from "@/components/database-chart";
import { DatabaseList } from "@/components/database-list";
import { DatabaseTimeline } from "@/components/database-timeline";
import { MediaImage } from "@/components/media-image";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  chartData,
  chartDateWindow,
  chartSeries,
  chartDatePresetWindow,
  parseChartDateBound,
  parseChartDateOffset,
  parseChartDatePreset,
  parseChartType,
} from "@/lib/database-chart";
import { listRows } from "@/lib/database-list";
import {
  applyView,
  parseViewFilters,
  parseViewSorts,
  visiblePropertyList,
} from "@/lib/database-view";
import { formatFormulaValue } from "@/lib/database-formula";
import {
  formulaValue,
  rollupValue,
  type CalculationProperty,
  type RelationTargetMap,
} from "@/lib/database-calculations";
import {
  IMAGE_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  isImageMimeType,
  parseFilePropertyValue,
  pickLocalFile,
  uploadAttachment,
  type FilePropertyValue,
} from "@/lib/media";
import { todayKey } from "@/lib/calendar";
import { parseTimelineRange } from "@/lib/timeline";

type EmbedProperty = CalculationProperty;
type EmbedRecord = {
  id: string;
  title: string;
  values: Record<string, unknown>;
  pageId?: string | null;
  relations?: Record<string, string[]>;
};
type EmbedData = {
  id: string;
  name: string;
  properties: EmbedProperty[];
  records: EmbedRecord[];
  views: { id: string; name: string; type: string; config: Record<string, unknown> }[];
};

function displayValue(value: unknown) {
  const file = parseFilePropertyValue(value);
  if (file) return file.filename || file.alt || "File";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value === undefined || value === null || value === "" ? "—" : String(value);
}

/** Renders a cell, using a typed file link instead of text for attachments. */
function displayNode(value: unknown): ReactNode {
  const file = parseFilePropertyValue(value);
  if (file) {
    return <AttachmentFileLink url={file.url} filename={file.filename || file.alt} mimeType={file.mimeType} />;
  }
  return displayValue(value);
}

function cellValue(
  record: EmbedRecord,
  property: EmbedProperty,
  properties: EmbedProperty[],
  targets: RelationTargetMap,
) {
  if (property.type === "rollup") return rollupValue(record, property, targets);
  if (property.type === "formula") return formatFormulaValue(formulaValue(record, property, properties, targets));
  return record.values[property.id];
}

function DatabaseEmbedView({ node, deleteNode }: NodeViewProps) {
  const databaseId = String(node.attrs.databaseId ?? "");
  const viewId = String(node.attrs.viewId ?? "");
  const [data, setData] = useState<EmbedData | null>(null);
  const [chartToday] = useState(() => todayKey());
  const [relationTargets, setRelationTargets] = useState<RelationTargetMap>({});
  const [error, setError] = useState("");
  const [viewSaving, setViewSaving] = useState(false);
  const [viewError, setViewError] = useState("");
  const [coverPendingRemoval, setCoverPendingRemoval] = useState<{ recordId: string; propertyId: string; title: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/databases/${databaseId}`);
        if (!response.ok) throw new Error("This database is unavailable.");
        const result: EmbedData = await response.json();
        // A rollup reads values from the records its relation points at, so the
        // embed loads those databases too, just as the database page does.
        const relationProperties = result.properties.filter(
          (property) => property.type === "relation" && typeof property.options.relatedDatabaseId === "string",
        );
        const targets = await Promise.all(relationProperties.map(async (property) => {
          const relatedId = String(property.options.relatedDatabaseId);
          try {
            const related: EmbedData | null = relatedId === databaseId
              ? result
              : await fetch(`/api/databases/${relatedId}`).then((relatedResponse) => relatedResponse.ok ? relatedResponse.json() : null);
            if (!related) return [property.id, { properties: [], records: [] }] as const;
            return [property.id, {
              properties: related.properties,
              records: related.records.map((relatedRecord) => ({ id: relatedRecord.id, values: relatedRecord.values })),
            }] as const;
          } catch {
            return [property.id, { properties: [], records: [] }] as const;
          }
        }));
        if (!cancelled) {
          setData(result);
          setRelationTargets(Object.fromEntries(targets));
          setError("");
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load database.");
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [databaseId]);

  const selectedView = data?.views.find((view) => view.id === viewId) ?? data?.views[0];
  const boardProperty = selectedView?.type === "board"
    ? data?.properties.find((property) => property.id === selectedView.config.groupBy && property.type === "select")
    : undefined;
  // An embed renders the same saved view as the database page, so it shows the
  // same properties. Embeds stay compact and cap the columns they display.
  const visibleProperties = visiblePropertyList(data?.properties ?? [], selectedView?.config);
  const galleryCoverProperties = visibleProperties.filter((property) => property.type === "file");
  const galleryCoverPropertyId = typeof selectedView?.config.coverPropertyId === "string"
    ? selectedView.config.coverPropertyId
    : "";
  const galleryCoverProperty = galleryCoverProperties.find((property) => property.id === galleryCoverPropertyId);
  const hiddenCoverRecordIds = new Set(
    Array.isArray(selectedView?.config.hiddenCoverRecordIds)
      ? selectedView.config.hiddenCoverRecordIds.filter((id): id is string => typeof id === "string")
      : [],
  );

  // Mirrors the main gallery: the chosen file property supplies the cover when
  // it holds an image, otherwise the first image attachment does.
  function coverForRecord(record: EmbedRecord): { file: FilePropertyValue; propertyId: string } | null {
    if (galleryCoverProperty) {
      const chosen = parseFilePropertyValue(record.values[galleryCoverProperty.id]);
      if (chosen && isImageMimeType(chosen.mimeType)) {
        return { file: chosen, propertyId: galleryCoverProperty.id };
      }
    }
    for (const property of galleryCoverProperties) {
      const file = parseFilePropertyValue(record.values[property.id]);
      if (file && isImageMimeType(file.mimeType)) return { file, propertyId: property.id };
    }
    return null;
  }

  async function saveViewConfig(config: Record<string, unknown>) {
    if (!data || !selectedView) return;
    setViewSaving(true);
    setViewError("");
    try {
      const response = await fetch(`/api/databases/${data.id}/views/${selectedView.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!response.ok) throw new Error("Could not save this view setting.");
      setData((views) => views ? {
        ...views,
        views: views.views.map((view) => view.id === selectedView.id ? { ...view, config } : view),
      } : views);
    } catch (saveError) {
      setViewError(saveError instanceof Error ? saveError.message : "Could not save this view setting.");
    } finally {
      setViewSaving(false);
    }
  }

  async function setCoverHidden(recordId: string, hidden: boolean) {
    if (!selectedView) return;
    const current = Array.isArray(selectedView.config.hiddenCoverRecordIds)
      ? selectedView.config.hiddenCoverRecordIds.filter((id): id is string => typeof id === "string")
      : [];
    const next = hidden
      ? Array.from(new Set([...current, recordId]))
      : current.filter((id) => id !== recordId);
    await saveViewConfig({ ...selectedView.config, hiddenCoverRecordIds: next });
  }

  async function setCoverProperty(propertyId: string) {
    if (!selectedView) return;
    await saveViewConfig({ ...selectedView.config, coverPropertyId: propertyId });
  }

  async function removeCover(recordId: string, propertyId: string) {
    if (!data) return;
    const record = data.records.find((row) => row.id === recordId);
    if (!record) return;
    setViewSaving(true);
    setViewError("");
    try {
      const response = await fetch(`/api/databases/${data.id}/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: { ...record.values, [propertyId]: null } }),
      });
      if (!response.ok) throw new Error("Could not remove the cover image.");
      const updated: EmbedRecord = await response.json();
      setData((current) => current ? {
        ...current,
        records: current.records.map((row) => row.id === recordId ? { ...row, values: updated.values } : row),
      } : current);
    } catch (removeError) {
      setViewError(removeError instanceof Error ? removeError.message : "Could not remove the cover image.");
    } finally {
      setViewSaving(false);
    }
  }

  async function uploadCover(recordId: string, propertyId: string) {
    const picked = await pickLocalFile(IMAGE_MIME_TYPES.join(","));
    if (!picked) return;
    if (!isImageMimeType(picked.type)) {
      setViewError("Choose an image file for the cover.");
      return;
    }
    if (picked.size > MAX_ATTACHMENT_BYTES) {
      setViewError("Cover images must be 10 MB or smaller.");
      return;
    }
    setViewSaving(true);
    setViewError("");
    try {
      const uploaded = await uploadAttachment(picked);
      const record = data?.records.find((row) => row.id === recordId);
      if (!data || !record) throw new Error("Could not find this record.");
      const response = await fetch(`/api/databases/${data.id}/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: {
            ...record.values,
            [propertyId]: {
              attachmentId: uploaded.id,
              url: uploaded.url,
              alt: "",
              filename: uploaded.filename,
              mimeType: uploaded.mimeType,
            },
          },
        }),
      });
      if (!response.ok) throw new Error("Could not save the cover image.");
      const updated: EmbedRecord = await response.json();
      setData((current) => current ? {
        ...current,
        records: current.records.map((row) => row.id === recordId ? { ...row, values: updated.values } : row),
      } : current);
    } catch (uploadError) {
      setViewError(uploadError instanceof Error ? uploadError.message : "Could not save the cover image.");
    } finally {
      setViewSaving(false);
    }
  }
  // An embed applies the same saved filters, search text, and sorts as the
  // database page, including filters and orders built on formulas and rollups.
  const viewFilters = parseViewFilters(selectedView?.config);
  const filterText = typeof selectedView?.config.filterText === "string"
    ? selectedView.config.filterText.trim().toLocaleLowerCase()
    : "";
  // Filters, lists, timelines, and charts all read calculated properties the
  // same way they appear on the database page.
  const valueFor = (record: EmbedRecord, property: { id: string; type: string }) => {
    const calculated = property.type === "rollup" || property.type === "formula"
      ? data?.properties.find((candidate) => candidate.id === property.id)
      : undefined;
    return calculated && data
      ? cellValue(record, calculated, data.properties, relationTargets)
      : record.values[property.id];
  };
  const sorted = data
    ? applyView(data.records, data.properties, viewFilters, parseViewSorts(selectedView?.config), { valueFor })
    : [];
  const records = filterText
    ? sorted.filter((record) => [
        record.title,
        ...Object.values(record.values).map((entry) => Array.isArray(entry) ? entry.join(" ") : String(entry ?? "")),
        ...(data?.properties ?? [])
          .filter((property) => property.type === "rollup" || property.type === "formula")
          .map((property) => displayValue(cellValue(record, property, data?.properties ?? [], relationTargets))),
      ].some((text) => text.toLocaleLowerCase().includes(filterText)))
    : sorted;
  const timelineRange = parseTimelineRange(selectedView?.config.timelineRange);
  const dateViewPropertyId = typeof selectedView?.config.datePropertyId === "string"
    ? selectedView.config.datePropertyId
    : "";
  const listRowsForView = listRows(records, visibleProperties, { valueFor, limit: 4 });
  const chartNumericProperties = (data?.properties ?? []).filter((property) =>
    property.type === "number" || property.type === "formula" || property.type === "rollup",
  );
  const chartSelectProperties = (data?.properties ?? []).filter((property) => property.type === "select");
  const chartPropertyId = typeof selectedView?.config.chartPropertyId === "string"
    ? selectedView.config.chartPropertyId
    : "";
  const chartGroupPropertyId = typeof selectedView?.config.chartGroupPropertyId === "string"
    ? selectedView.config.chartGroupPropertyId
    : "";
  const chartProperty = chartNumericProperties.find((property) => property.id === chartPropertyId)
    ?? chartNumericProperties[0];
  const chartGroupProperty = chartSelectProperties.find((property) => property.id === chartGroupPropertyId);
  const chartBarProperty = chartProperty
    ? { id: chartProperty.id, name: chartProperty.name, type: chartProperty.type }
    : null;
  const chartGroups = chartGroupProperty
    ? {
        id: chartGroupProperty.id,
        name: chartGroupProperty.name,
        type: chartGroupProperty.type,
        options: {
          choices: Array.isArray(chartGroupProperty.options.choices)
            ? chartGroupProperty.options.choices.filter((choice): choice is string => typeof choice === "string")
            : [],
        },
      }
    : null;
  const chart = chartBarProperty
    ? chartData(records, chartBarProperty, { valueFor, groupBy: chartGroups })
    : null;
  const chartDateProperties = (data?.properties ?? []).filter((property) => property.type === "date");
  const chartDatePropertyId = typeof selectedView?.config.chartDatePropertyId === "string"
    ? selectedView.config.chartDatePropertyId
    : "";
  const chartDateProperty = chartDateProperties.find((property) => property.id === chartDatePropertyId);
  const chartDateRange = parseTimelineRange(selectedView?.config.chartDateRange);
  const chartDateOffset = parseChartDateOffset(selectedView?.config.chartDateOffset);
  const chartDatePreset = parseChartDatePreset(selectedView?.config.chartDatePreset);
  const chartPresetWindow = chartDatePreset
    ? chartDatePresetWindow(chartToday, chartDatePreset)
    : null;
  const chartDateStart = chartPresetWindow?.from
    ?? parseChartDateBound(selectedView?.config.chartDateStart)
    ?? "";
  const chartDateEnd = chartPresetWindow?.to
    ?? parseChartDateBound(selectedView?.config.chartDateEnd)
    ?? "";
  const chartWindow = chartDateProperty
    ? chartDateWindow(
        chartToday,
        chartDateRange,
        chartDateOffset,
        chartDateStart,
        chartDateEnd,
        chartDatePreset,
      )
    : null;
  const chartType = parseChartType(selectedView?.config.chartType);
  const chartSeriesForView = chartType === "line" && chartBarProperty
    ? chartSeries(records, chartBarProperty, {
        valueFor,
        dateProperty: chartDateProperty ?? null,
        dateWindow: chartWindow,
      })
    : null;

  return (
    <NodeViewWrapper className="my-5" contentEditable={false}>
      <section className="overflow-hidden rounded-lg border bg-background">
        <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <Database size={15} className="shrink-0 text-muted-foreground" />
            <span className="truncate">{data?.name ?? (error ? "Unavailable database" : "Loading database…")}</span>
            {selectedView && <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">{selectedView.name}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link href={`/databases/${databaseId}`} target="_blank" aria-label="Open full database" title="Open full database" className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
              <ExternalLink size={15} />
            </Link>
            <Button type="button" variant="ghost" size="icon-sm" onClick={deleteNode} aria-label="Remove database embed" title="Remove embed">
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
        {viewError && <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">{viewError}</p>}
        {error ? (
          <p role="alert" className="p-4 text-sm text-destructive">{error}</p>
        ) : data ? (
          selectedView?.type === "gallery" ? (
            <div>
              {galleryCoverProperties.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
                  <label className="flex items-center gap-2 text-muted-foreground">
                    Cover image
                    <select
                      value={galleryCoverProperty?.id ?? ""}
                      onChange={(event) => void setCoverProperty(event.target.value)}
                      disabled={viewSaving}
                      className="rounded border bg-background px-2 py-1 text-foreground disabled:opacity-50"
                    >
                      <option value="">First image attachment</option>
                      {galleryCoverProperties.map((property) => (
                        <option key={property.id} value={property.id}>{property.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <div className="grid max-h-96 gap-3 overflow-y-auto p-3 sm:grid-cols-2">
              {records.map((record) => {
                const cover = coverForRecord(record);
                const coverHidden = Boolean(cover) && hiddenCoverRecordIds.has(record.id);
                const coverTargetId = cover?.propertyId ?? galleryCoverProperty?.id ?? galleryCoverProperties[0]?.id;
                return (
                  <article key={record.id} className="overflow-hidden rounded-md border p-3">
                    {cover && !coverHidden && (
                      <div className="relative -mx-3 -mt-3 mb-2 border-b bg-muted/20">
                        <Link
                          href={`/databases/${data.id}/records/${record.id}`}
                          title={`Open ${record.title} — Ctrl/Cmd-click to open in a new tab`}
                          className="block"
                        >
                          <MediaImage
                            src={cover.file.url}
                            alt={cover.file.alt || cover.file.filename || record.title}
                            className="h-28 w-full object-cover"
                          />
                        </Link>
                        <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => coverTargetId && void uploadCover(record.id, coverTargetId)}
                            disabled={viewSaving}
                            aria-label={`Replace cover for ${record.title}`}
                            title="Replace cover"
                            className="inline-flex size-6 items-center justify-center rounded border bg-background/90 text-muted-foreground shadow-sm hover:text-foreground disabled:opacity-50"
                          >
                            <Upload size={11} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!coverTargetId) return;
                              setCoverPendingRemoval({
                                recordId: record.id,
                                propertyId: coverTargetId,
                                title: record.title,
                              });
                            }}
                            disabled={viewSaving}
                            aria-label={`Remove cover for ${record.title}`}
                            title="Remove cover"
                            className="inline-flex size-6 items-center justify-center rounded border bg-background/90 text-muted-foreground shadow-sm hover:text-destructive disabled:opacity-50"
                          >
                            <Trash2 size={11} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void setCoverHidden(record.id, true)}
                            disabled={viewSaving}
                            aria-label={`Hide cover for ${record.title}`}
                            title="Hide cover"
                            className="inline-flex items-center gap-1 rounded border bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm hover:text-foreground disabled:opacity-50"
                          >
                            <EyeOff size={11} aria-hidden="true" /> Hide
                          </button>
                        </div>
                      </div>
                    )}
                    {cover && coverHidden && (
                      <button
                        type="button"
                        onClick={() => void setCoverHidden(record.id, false)}
                        disabled={viewSaving}
                        aria-label={`Show cover for ${record.title}`}
                        title="Show cover"
                        className="mb-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        <Eye size={11} aria-hidden="true" /> Show cover
                      </button>
                    )}
                    {!cover && coverTargetId && (
                      <button
                        type="button"
                        onClick={() => void uploadCover(record.id, coverTargetId)}
                        disabled={viewSaving}
                        aria-label={`Add cover for ${record.title}`}
                        title="Add cover"
                        className="mb-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        <Upload size={11} aria-hidden="true" /> Add cover
                      </button>
                    )}
                    <h3 className="text-sm font-medium">
                      <Link href={`/databases/${data.id}/records/${record.id}`} title={`Open ${record.title} — Ctrl/Cmd-click to open in a new tab`} className="hover:text-primary hover:underline">{record.title}</Link>
                    </h3>
                    <dl className="mt-2 space-y-1 text-xs">
                      {visibleProperties.slice(0, 4).map((property) => (
                        <div key={property.id} className="flex gap-2">
                          <dt className="shrink-0 text-muted-foreground">
                            {property.name}
                            {property.id === cover?.propertyId && (
                              <span className="ml-1 rounded border px-1 py-0.5 text-[9px] uppercase">Cover</span>
                            )}
                          </dt>
                          <dd className="min-w-0 truncate">{displayNode(cellValue(record, property, data.properties, relationTargets))}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                );
              })}
              {records.length === 0 && <p className="col-span-full py-5 text-center text-sm text-muted-foreground">{viewFilters.length > 0 || filterText ? "No records match this filter." : "No records yet."}</p>}
              </div>
            </div>
          ) : selectedView?.type === "board" && boardProperty ? (
            <div className="grid max-h-96 gap-3 overflow-auto p-3 md:grid-flow-col md:auto-cols-[minmax(180px,1fr)]">
              {["", ...(Array.isArray(boardProperty.options.choices) ? boardProperty.options.choices : [])].map((choice) => {
                const columnRecords = records.filter((record) => String(record.values[boardProperty.id] ?? "") === choice);
                return (
                  <section key={choice || "__empty"} className="min-h-36 rounded-md bg-muted/40 p-2">
                    <h3 className="mb-2 text-xs font-medium">{choice || "No value"} <span className="text-muted-foreground">{columnRecords.length}</span></h3>
                    <div className="space-y-2">
                      {columnRecords.map((record) => (
                        <div key={record.id} className="rounded border bg-background p-2 text-xs">
                          <p className="font-medium">
                            <Link href={`/databases/${data.id}/records/${record.id}`} title={`Open ${record.title} — Ctrl/Cmd-click to open in a new tab`} className="hover:text-primary hover:underline">{record.title}</Link>
                          </p>
                          {visibleProperties.length > 0 && (
                            <dl className="mt-1 space-y-0.5">
                              {visibleProperties.slice(0, 4).map((property) => (
                                <div key={property.id} className="flex gap-1">
                                  <dt className="shrink-0 text-muted-foreground">{property.name}</dt>
                                  <dd className="min-w-0 truncate">{displayNode(cellValue(record, property, data.properties, relationTargets))}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : selectedView?.type === "list" ? (
            <div className="max-h-96 overflow-y-auto p-3">
              <DatabaseList databaseId={data.id} rows={listRowsForView} />
            </div>
          ) : selectedView?.type === "timeline" ? (
            <div className="max-h-96 overflow-y-auto p-3">
              <DatabaseTimeline
                databaseId={data.id}
                properties={data.properties}
                records={records}
                datePropertyId={dateViewPropertyId}
                range={timelineRange}
                onDatePropertyChange={(propertyId) => void saveViewConfig({ ...selectedView.config, datePropertyId: propertyId })}
                onRangeChange={(range) => void saveViewConfig({ ...selectedView.config, timelineRange: range })}
              />
            </div>
          ) : selectedView?.type === "chart" ? (
            <div className="max-h-96 overflow-y-auto p-3">
              <DatabaseChart
                databaseId={data.id}
                sourceViewId={selectedView.id}
                chart={chart}
                series={chartSeriesForView}
                properties={chartNumericProperties}
                groupProperties={chartSelectProperties}
                dateProperties={chartDateProperties}
                propertyId={chartBarProperty?.id ?? ""}
                groupPropertyId={chartGroupProperty?.id ?? ""}
                datePropertyId={chartDateProperty?.id ?? ""}
                dateRange={chartDateRange}
                dateOffset={chartDateOffset}
                dateStart={chartDateStart}
                dateEnd={chartDateEnd}
                datePreset={chartDatePreset}
                type={chartType}
                onPropertyChange={(propertyId) => void saveViewConfig({ ...selectedView.config, chartPropertyId: propertyId })}
                onGroupChange={(propertyId) => void saveViewConfig({ ...selectedView.config, chartGroupPropertyId: propertyId })}
                onDatePropertyChange={(propertyId) => void saveViewConfig({ ...selectedView.config, chartDatePropertyId: propertyId })}
                onDateRangeChange={(range) => void saveViewConfig({
                  ...selectedView.config,
                  chartDateRange: range,
                  chartDateStart: null,
                  chartDateEnd: null,
                  chartDatePreset: null,
                })}
                onDateOffsetChange={(offset) => void saveViewConfig({ ...selectedView.config, chartDateOffset: offset })}
                onDateChange={(start, end) => void saveViewConfig({
                  ...selectedView.config,
                  chartDateStart: start || null,
                  chartDateEnd: end || null,
                  chartDatePreset: null,
                })}
                onDatePresetChange={(preset) => void saveViewConfig({
                  ...selectedView.config,
                  chartDatePreset: preset,
                  chartDateStart: null,
                  chartDateEnd: null,
                })}
                onDateWindowClear={() => void saveViewConfig({
                  ...selectedView.config,
                  chartDatePropertyId: "",
                  chartDateStart: null,
                  chartDateEnd: null,
                  chartDatePreset: null,
                  chartDateOffset: 0,
                })}
                onTypeChange={(chartType) => void saveViewConfig({ ...selectedView.config, chartType })}
              />
            </div>
          ) : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b text-left">
                  <th className="bg-background px-3 py-2 font-medium">Name</th>
                  {visibleProperties.slice(0, 4).map((property) => <th key={property.id} className="bg-background px-3 py-2 font-medium">{property.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/databases/${data.id}/records/${record.id}`} title={`Open ${record.title} — Ctrl/Cmd-click to open in a new tab`} className="hover:text-primary hover:underline">{record.title}</Link>
                    </td>
                    {visibleProperties.slice(0, 4).map((property) => <td key={property.id} className="max-w-56 truncate px-3 py-2 text-muted-foreground">{displayNode(cellValue(record, property, data.properties, relationTargets))}</td>)}
                  </tr>
                ))}
                {records.length === 0 && <tr><td colSpan={Math.min(visibleProperties.length, 4) + 1} className="px-3 py-7 text-center text-muted-foreground">{viewFilters.length > 0 || filterText ? "No records match this filter." : "No records yet."}</td></tr>}
              </tbody>
            </table>
          </div>
          )
        ) : (
          <div className="p-5 text-sm text-muted-foreground">Loading database view…</div>
        )}
      </section>

      <AlertDialog
        open={Boolean(coverPendingRemoval)}
        onOpenChange={(open) => { if (!open) setCoverPendingRemoval(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this cover image?</AlertDialogTitle>
            <AlertDialogDescription>
              The cover for “{coverPendingRemoval?.title ?? "this record"}” will be cleared. Its file property row stays ready for a new upload.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const pending = coverPendingRemoval;
                setCoverPendingRemoval(null);
                if (pending) void removeCover(pending.recordId, pending.propertyId);
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Remove cover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </NodeViewWrapper>
  );
}

export const DatabaseEmbedExtension = Node.create({
  name: "databaseEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      databaseId: { default: null },
      viewId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="database-embed"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "database-embed" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DatabaseEmbedView);
  },
});

type DatabaseOption = { id: string; name: string };
type ViewOption = { id: string; name: string; type: string };

export function DatabaseEmbedPicker({ editor }: { editor: import("@tiptap/react").Editor | null }) {
  const [databases, setDatabases] = useState<DatabaseOption[]>([]);
  const [views, setViews] = useState<ViewOption[]>([]);
  const [databaseId, setDatabaseId] = useState("");
  const [viewId, setViewId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadDatabases() {
      try {
        const response = await fetch("/api/databases");
        if (!response.ok) throw new Error("Could not load databases.");
        const result: DatabaseOption[] = await response.json();
        if (!cancelled) {
          setDatabases(result);
          setDatabaseId(result[0]?.id ?? "");
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load databases.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadDatabases();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!databaseId) return;
    let cancelled = false;
    async function loadViews() {
      try {
        const response = await fetch(`/api/databases/${databaseId}`);
        if (!response.ok) throw new Error("Could not load database views.");
        const result: { views: ViewOption[] } = await response.json();
        if (!cancelled) {
          setViews(result.views);
          setViewId(result.views.find((view) => view.type === "table")?.id ?? result.views[0]?.id ?? "");
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load views.");
      }
    }
    void loadViews();
    return () => { cancelled = true; };
  }, [databaseId]);

  function insertEmbed() {
    if (!editor || !databaseId) return;
    editor.chain().focus().insertContent({
      type: "databaseEmbed",
      attrs: { databaseId, viewId: viewId || null },
    }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="database-embed-picker">Database to embed</label>
      <select id="database-embed-picker" value={databaseId} onChange={(event) => { setDatabaseId(event.target.value); setViewId(""); }} disabled={loading || databases.length === 0} className="max-w-52 rounded-md border bg-background px-2 py-1.5 text-xs">
        <option value="">Choose database…</option>
        {databases.map((database) => <option key={database.id} value={database.id}>{database.name}</option>)}
      </select>
      {views.length > 1 && (
        <select aria-label="Database view to embed" value={viewId} onChange={(event) => setViewId(event.target.value)} className="max-w-40 rounded-md border bg-background px-2 py-1.5 text-xs">
          {views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
        </select>
      )}
      <Button type="button" variant="outline" size="sm" onClick={insertEmbed} disabled={!editor || !databaseId || loading}>
        <Database size={14} /> Insert database
      </Button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
