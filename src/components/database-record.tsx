"use client";

import { useCallback, useEffect, useState, type DragEvent as ReactDragEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Link2, Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ButtonCell, buttonResultMessage, runDatabaseButton } from "@/components/button-cell";
import { ButtonSettingsDialog } from "@/components/button-settings-dialog";
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
import { MultiSelectCell } from "@/components/database-cell-editors";
import {
  BooleanPill,
  CalculatedValue,
  DateLabel,
  PropertyTypeBadge,
  StatusChips,
} from "@/components/property-display";
import { FileCell } from "@/components/file-cell";
import { PageEditorLoader } from "@/components/page-editor-loader";
import { RecordConnections } from "@/components/record-connections";
import type { RecordBacklink } from "@/components/record-backlinks";
import { RelationCell } from "@/components/relation-cell";
import { Button } from "@/components/ui/button";
import { formatFormulaValue } from "@/lib/database-formula";
import type { DatabasePropertyType } from "@/lib/database-property";
import { formulaValue, rollupValue } from "@/lib/database-calculations";
import { readHiddenPropertyIds, setPropertyHidden, writeHiddenPropertyIds } from "@/lib/database-record-prefs";
import { recordHref } from "@/lib/record-link";
import { isViewMode, viewModeHref } from "@/lib/view-mode";

type Property = {
  id: string;
  name: string;
  type: DatabasePropertyType;
  options: {
    choices?: string[];
    relatedDatabaseId?: string;
    relationPropertyId?: string;
    targetPropertyId?: string;
    aggregation?: string;
    expression?: string;
    actions?: import("@/lib/database-button").ButtonAction[];
  };
};
type RecordRow = {
  id: string;
  title: string;
  values: Record<string, unknown>;
  pageId: string | null;
  relations: Record<string, string[]>;
};
type RelatedRecord = { id: string; title: string; values: Record<string, unknown>; pageId?: string | null };
type RelationTargetData = { properties: Property[]; records: RelatedRecord[] };
type RecordDetail = RecordRow & {
  properties: Property[];
  backlinks: RecordBacklink[];
  database: { id: string; name: string };
};

const PROPERTY_DRAG_MIME = "application/x-kbs-record-property";

export function DatabaseRecordWorkspace({
  databaseId,
  recordId,
}: {
  databaseId: string;
  recordId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const readOnly = isViewMode(searchParams);
  const [record, setRecord] = useState<RecordRow | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [databaseName, setDatabaseName] = useState("");
  const [title, setTitle] = useState("");
  const [relationTargets, setRelationTargets] = useState<Record<string, RelationTargetData>>({});
  const [backlinks, setBacklinks] = useState<RecordBacklink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingButtonProperty, setEditingButtonProperty] = useState<Property | null>(null);
  const [showConnections, setShowConnections] = useState(false);
  const [showProperties, setShowProperties] = useState(true);
  const [hiddenPropertyIds, setHiddenPropertyIds] = useState<string[]>(() => readHiddenPropertyIds(databaseId));
  const [reorderingProperties, setReorderingProperties] = useState(false);
  const [draggedPropertyId, setDraggedPropertyId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        // This request also creates the record's page when an older record
        // does not have one yet.
        const response = await fetch(`/api/databases/${databaseId}/records/${recordId}`);
        if (!response.ok) {
          throw new Error(response.status === 404 ? "Record not found." : "Could not load record.");
        }
        const detail: RecordDetail = await response.json();
        if (cancelled) return;
        setRecord(detail);
        setProperties(detail.properties);
        setTitle(detail.title);
        setDatabaseName(detail.database.name);
        setBacklinks(detail.backlinks ?? []);

        const relationProperties = detail.properties.filter((property) => {
          if (property.type !== "relation") return false;
          return typeof property.options.relatedDatabaseId === "string";
        });
        const targets = await Promise.all(relationProperties.map(async (property) => {
          const relatedId = property.options.relatedDatabaseId;
          if (!relatedId) return [property.id, { properties: [], records: [] }] as const;
          const relatedResponse = await fetch(`/api/databases/${relatedId}`);
          if (!relatedResponse.ok) return [property.id, { properties: [], records: [] }] as const;
          const related: { properties: Property[]; records: RelatedRecord[] } = await relatedResponse.json();
          return [property.id, { properties: related.properties, records: related.records }] as const;
        }));
        if (!cancelled) setRelationTargets(Object.fromEntries(targets));
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load record.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [databaseId, recordId]);

  const applyUpdate = useCallback(
    async (changes: Partial<Pick<RecordRow, "title" | "values" | "pageId" | "relations">>) => {
      setSaving(true);
      setError("");
      try {
        const response = await fetch(`/api/databases/${databaseId}/records/${recordId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        });
        if (!response.ok) throw new Error("Could not save this record.");
        const updated: RecordRow = await response.json();
        setRecord(updated);
        setTitle(updated.title);
        if (changes.title !== undefined) {
          window.dispatchEvent(new Event("pages-updated"));
        }
        return true;
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Could not save this record.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [databaseId, recordId],
  );

  async function saveTitle() {
    if (!record) return;
    const nextTitle = title.trim() || "Untitled";
    setTitle(nextTitle);
    if (nextTitle === record.title) return;
    await applyUpdate({ title: nextTitle });
  }

  function updateValue(propertyId: string, value: unknown) {
    if (!record) return;
    void applyUpdate({ values: { ...record.values, [propertyId]: value } });
  }

  function updateRelations(property: Property, selected: string[]) {
    if (!record) return;
    void applyUpdate({ relations: { ...record.relations, [property.id]: selected } });
  }

  /**
   * Property order is the database's column order, so a move made here also
   * moves the column in every view and every other record. The list updates
   * first and returns to its previous order if the request fails.
   */
  async function savePropertyOrder(propertyIds: string[], previous: Property[]) {
    const byId = new Map(previous.map((property) => [property.id, property]));
    setProperties(
      propertyIds
        .map((propertyId) => byId.get(propertyId))
        .filter((property): property is Property => Boolean(property)),
    );

    setReorderingProperties(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${databaseId}/properties/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "Could not move this property.");
      }
    } catch (moveError) {
      setProperties(previous);
      setError(moveError instanceof Error ? moveError.message : "Could not move this property.");
    } finally {
      setReorderingProperties(false);
    }
  }

  async function moveProperty(propertyId: string, direction: "up" | "down") {
    if (reorderingProperties) return;
    const index = properties.findIndex((property) => property.id === propertyId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= properties.length) return;

    const propertyIds = properties.map((property) => property.id);
    [propertyIds[index], propertyIds[target]] = [propertyIds[target], propertyIds[index]];
    await savePropertyOrder(propertyIds, properties);
  }

  /** Drops one property in front of `beforeId`, or at the end when it is null. */
  async function movePropertyTo(propertyId: string, beforeId: string | null) {
    if (reorderingProperties || propertyId === beforeId) return;
    const propertyIds = properties.map((property) => property.id).filter((id) => id !== propertyId);
    const target = beforeId === null ? propertyIds.length : propertyIds.indexOf(beforeId);
    if (target === -1) return;
    propertyIds.splice(target, 0, propertyId);
    await savePropertyOrder(propertyIds, properties);
  }

  function startPropertyDrag(event: ReactDragEvent<HTMLElement>, propertyId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(PROPERTY_DRAG_MIME, propertyId);
    event.dataTransfer.setData("text/plain", propertyId);
    setDraggedPropertyId(propertyId);
  }

  function finishPropertyDrag() {
    setDraggedPropertyId(null);
    setDropTarget(null);
  }

  function dropProperty(event: ReactDragEvent<HTMLElement>, beforeId: string | null) {
    event.preventDefault();
    const raw =
      event.dataTransfer.getData(PROPERTY_DRAG_MIME) || event.dataTransfer.getData("text/plain");
    const propertyId = properties.some((property) => property.id === raw) ? raw : draggedPropertyId;
    if (propertyId) void movePropertyTo(propertyId, beforeId);
    finishPropertyDrag();
  }

  function getRollupValue(property: Property): number | string {
    if (!record) return "—";
    return rollupValue(record, property, relationTargets);
  }

  function getFormulaValue(property: Property): number | null {
    if (!record) return null;
    return formulaValue(record, property, properties, relationTargets);
  }

  async function runButton(property: Property) {
    if (!record) return "This record is not loaded.";
    const result = await runDatabaseButton(databaseId, record.id, property.id);
    setRecord((current) => current ? {
      ...current,
      ...result.record,
      relations: result.relations,
    } : current);
    setTitle(result.record.title);
    return buttonResultMessage(result.results);
  }

  // A record is often reached from an embed inside a page, so the first back
  // step returns to that page. A record opened directly falls back to its
  // database instead of leaving the app.
  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push(`/databases/${databaseId}`);
  }

  async function deleteRecord() {
    if (!record) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${databaseId}/records/${recordId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete this record.");
      router.push(`/databases/${databaseId}`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete this record.");
      setDeleting(false);
    }
  }

  function setViewMode(next: boolean) {
    router.replace(
      viewModeHref(window.location.pathname, searchParams.toString(), next),
      { scroll: false },
    );
  }

  function renderProperty(property: Property) {
    if (!record) return null;
    const value = record.values[property.id];

    if (property.type === "button") {
      return (
        <div className="px-3 py-2">
          <ButtonCell
            label={property.name}
            onRun={() => runButton(property)}
            onConfigure={readOnly ? undefined : () => setEditingButtonProperty(property)}
          />
        </div>
      );
    }

    if (property.type === "formula") {
      return (
        <div className="px-3 py-2" aria-label={`${property.name} calculated value`}>
          <CalculatedValue value={formatFormulaValue(getFormulaValue(property))} />
        </div>
      );
    }

    if (property.type === "rollup") {
      const rollup = getRollupValue(property);
      return (
        <div className="px-3 py-2" aria-label={`${property.name} calculated value`}>
          <CalculatedValue value={typeof rollup === "number" ? rollup.toLocaleString() : rollup} />
        </div>
      );
    }

    if (readOnly && property.type === "relation") {
      const targets = relationTargets[property.id]?.records ?? [];
      const selectedIds = record.relations[property.id] ?? [];
      const relatedDatabaseId = property.options.relatedDatabaseId;
      return selectedIds.length === 0 ? (
        <span className="block px-3 py-2 text-sm text-muted-foreground">—</span>
      ) : (
        <div className="flex flex-wrap gap-1.5 px-3 py-2">
          {selectedIds.map((targetId) => {
            const target = targets.find((item) => item.id === targetId);
            const label = target?.title || "Untitled";
            return relatedDatabaseId ? (
              <Link
                key={targetId}
                href={recordHref(relatedDatabaseId, targetId, target?.pageId)}
                className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:border-indigo-300 hover:text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300"
              >
                {label} <ArrowUpRight size={11} aria-hidden="true" />
              </Link>
            ) : (
              <span key={targetId} className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300">
                {label}
              </span>
            );
          })}
        </div>
      );
    }

    if (readOnly && property.type === "file") {
      return (
        <FileCell
          label={property.name}
          value={value}
          readOnly
          onChange={() => {}}
        />
      );
    }

    if (readOnly && property.type === "checkbox") {
      return (
        <div className="px-3 py-2">
          <BooleanPill value={Boolean(value)} />
        </div>
      );
    }

    if (readOnly && property.type === "multi_select") {
      const choices = Array.isArray(value)
        ? value.filter((choice): choice is string => typeof choice === "string")
        : [];
      return (
        <div className="px-3 py-2">
          <StatusChips values={choices} />
        </div>
      );
    }

    if (readOnly) {
      const currentValue = value === null || value === undefined || value === ""
        ? ""
        : String(value);
      if (property.type === "date") {
        return (
          <div className="px-3 py-2">
            <DateLabel value={currentValue} />
          </div>
        );
      }
      if (property.type === "select") {
        return (
          <div className="px-3 py-2">
            <StatusChips values={currentValue ? [currentValue] : []} />
          </div>
        );
      }
      if (property.type === "url" && currentValue) {
        return (
          <a
            href={currentValue}
            target="_blank"
            rel="noreferrer"
            className="block break-words px-3 py-2 text-sm text-primary hover:underline"
          >
            {currentValue}
          </a>
        );
      }
      return (
        <span
          className={`block whitespace-pre-wrap break-words px-3 py-2 text-sm ${
            property.type === "number" ? "font-medium tabular-nums" : ""
          }`}
        >
          {currentValue || <span className="text-muted-foreground">—</span>}
        </span>
      );
    }

    if (property.type === "relation") {
      const targets = relationTargets[property.id]?.records ?? [];
      return (
        <RelationCell
          label={property.name}
          value={record.relations[property.id] ?? []}
          options={targets.map((target) => ({
            id: target.id,
            title: target.title || "Untitled",
          }))}
          onChange={(next) => updateRelations(property, next)}
        />
      );
    }

    if (property.type === "file") {
      return (
        <FileCell
          label={property.name}
          value={value}
          disabled={saving}
          onChange={(next) => updateValue(property.id, next)}
        />
      );
    }

    if (property.type === "checkbox") {
      return (
        <label className="flex items-center gap-2 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => updateValue(property.id, event.currentTarget.checked)}
            className="size-4 accent-primary"
          />
          {value ? "Checked" : "Unchecked"}
        </label>
      );
    }

    if (property.type === "select") {
      return (
        <select
          aria-label={property.name}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => updateValue(property.id, event.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">No value</option>
          {(property.options.choices ?? []).map((choice) => (
            <option key={choice} value={choice}>{choice}</option>
          ))}
        </select>
      );
    }

    if (property.type === "multi_select") {
      return (
        <MultiSelectCell
          label={property.name}
          recordTitle={record.title}
          value={Array.isArray(value)
            ? value.filter((choice): choice is string => typeof choice === "string")
            : []}
          choices={property.options.choices ?? []}
          onChange={(next) => updateValue(property.id, next)}
        />
      );
    }

    const inputType = property.type === "number"
      ? "number"
      : property.type === "date"
        ? "date"
        : property.type === "url"
          ? "url"
          : "text";
    const currentValue = value === null || value === undefined ? "" : String(value);

    return (
      <input
        type={inputType}
        aria-label={property.name}
        key={`${record.id}:${property.id}:${currentValue}`}
        defaultValue={currentValue}
        onBlur={(event) => {
          const raw = event.currentTarget.value;
          if (raw === currentValue) return;
          const next = property.type === "number" ? (raw === "" ? null : Number(raw)) : raw;
          if (property.type === "number" && next !== null && !Number.isFinite(next)) {
            setError(`${property.name} needs a number.`);
            return;
          }
          updateValue(property.id, next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
    );
  }

  if (loading) {
    return (
      <AppShell>
        <div role="status" aria-label="Loading record" className="w-full animate-pulse space-y-6">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-10 w-2/3 rounded bg-muted" />
          <div className="h-56 rounded-xl border bg-muted/20" />
          <div className="h-64 rounded-xl border bg-muted/10" />
        </div>
      </AppShell>
    );
  }

  if (!record) {
    return (
      <AppShell>
        <div role="alert" className="w-full space-y-3 rounded-lg border border-destructive/30 p-4">
          <p className="text-sm text-destructive">{error || "Record not found."}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => router.push(`/databases/${databaseId}`)}>
            Back to database
          </Button>
        </div>
      </AppShell>
    );
  }

  function hideProperty(propertyId: string) {
    setHiddenPropertyIds(setPropertyHidden(databaseId, propertyId, true));
  }

  function showProperty(propertyId: string) {
    setHiddenPropertyIds(setPropertyHidden(databaseId, propertyId, false));
  }

  function showAllProperties() {
    setHiddenPropertyIds(writeHiddenPropertyIds(databaseId, []));
  }

  const hiddenPropertySet = new Set(hiddenPropertyIds);
  const visibleProperties = properties.filter((property) => !hiddenPropertySet.has(property.id));
  const hiddenProperties = properties.filter((property) => hiddenPropertySet.has(property.id));

  // The properties render inside the page editor, right above the body, so a
  // record reads as one page instead of a page with a properties block bolted
  // onto the bottom.
  const propertiesPanel = (
    <section
      id="record-properties"
      aria-labelledby="record-properties-heading"
      hidden={!showProperties}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="record-properties-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Properties
        </h2>
        {hiddenProperties.length > 0 && (
          <details className="relative">
            <summary
              title="Show a hidden property"
              className="flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
            >
              Hidden properties
              <span className="tabular-nums">{hiddenProperties.length}</span>
              <ChevronDown size={12} aria-hidden="true" />
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border bg-popover p-1 shadow-lg">
              <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">Hidden on entry pages</p>
              <div className="max-h-64 overflow-y-auto">
                {hiddenProperties.map((property) => (
                  <button
                    key={property.id}
                    type="button"
                    aria-label={`Show ${property.name}`}
                    onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      showProperty(property.id);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Eye size={14} aria-hidden="true" />
                    <span className="min-w-0 truncate">{property.name}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={showAllProperties}
                className="mt-1 w-full rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Show all properties
              </button>
            </div>
          </details>
        )}
      </div>
      <div className="pt-3">
        {properties.length === 0 ? (
          <p className="text-sm text-muted-foreground">This database has no properties yet.</p>
        ) : visibleProperties.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            All properties are hidden. Use “Hidden properties” above to show one.
          </p>
        ) : (
          <dl className="grid gap-5 sm:grid-cols-2">
            {visibleProperties.map((property) => {
              const propertyIndex = properties.findIndex((candidate) => candidate.id === property.id);
              return (
              <div
                key={property.id}
                data-record-property={property.id}
                onDragOver={readOnly ? undefined : (event) => {
                  if (!draggedPropertyId) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget(property.id);
                }}
                onDragLeave={readOnly ? undefined : () =>
                  setDropTarget((current) => (current === property.id ? null : current))}
                onDrop={readOnly ? undefined : (event) => dropProperty(event, property.id)}
                className={`min-w-0 space-y-1.5 rounded-md ${
                  dropTarget === property.id && draggedPropertyId !== property.id
                    ? "outline outline-1 outline-offset-2 outline-primary/40"
                    : ""
                } ${draggedPropertyId === property.id ? "opacity-50" : ""}`}
              >
                <dt className="flex items-center gap-2 text-sm font-medium">
                  {!readOnly && (
                    <button
                      type="button"
                      draggable
                      aria-label={`Drag ${property.name} to reorder`}
                      title="Drag to reorder"
                      onDragStart={(event) => startPropertyDrag(event, property.id)}
                      onDragEnd={finishPropertyDrag}
                      className="cursor-grab rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                    >
                      <GripVertical size={13} aria-hidden="true" />
                    </button>
                  )}
                  <span className="min-w-0 break-words">{property.name}</span>
                  <PropertyTypeBadge type={property.type} />
                  {!readOnly && (
                    <span className="ml-auto flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-label={`Move ${property.name} up`}
                        title="Move this property up (the order is shared by every record and view)"
                        onClick={() => void moveProperty(property.id, "up")}
                        disabled={reorderingProperties || propertyIndex === 0}
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                      >
                        <ArrowUp size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${property.name} down`}
                        title="Move this property down (the order is shared by every record and view)"
                        onClick={() => void moveProperty(property.id, "down")}
                        disabled={reorderingProperties || propertyIndex === properties.length - 1}
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                      >
                        <ArrowDown size={13} aria-hidden="true" />
                      </button>
                    </span>
                  )}
                  <span className={`${readOnly ? "ml-auto " : ""}flex items-center`}>
                    <button
                      type="button"
                      aria-label={`Hide ${property.name}`}
                      title="Hide this property on entry pages"
                      onClick={() => hideProperty(property.id)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <EyeOff size={13} aria-hidden="true" />
                    </button>
                  </span>
                </dt>
                <dd className="min-w-0">{renderProperty(property)}</dd>
              </div>
              );
            })}
          </dl>
        )}
        {!readOnly && draggedPropertyId && (
          <div
            data-record-property-drop-end
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTarget("end");
            }}
            onDragLeave={() => setDropTarget((current) => (current === "end" ? null : current))}
            onDrop={(event) => dropProperty(event, null)}
            className={`mt-3 flex items-center justify-center rounded-md border border-dashed p-2 text-xs ${
              dropTarget === "end" ? "border-primary text-primary" : "text-muted-foreground"
            }`}
          >
            Drop here to move it to the end
          </div>
        )}
      </div>
    </section>
  );

  return (
    <AppShell>
      <div className="w-full space-y-8">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <button
              type="button"
              onClick={goBack}
              aria-label="Back to previous page"
              className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft size={15} /> Back
            </button>
            <span aria-hidden="true">·</span>
            <Link href={`/databases/${databaseId}`} className="rounded hover:text-foreground">
              {databaseName || "Database"}
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={showProperties}
              aria-controls="record-properties"
              aria-label={showProperties ? "Hide properties" : "Show properties"}
              title={showProperties ? "Hide properties" : "Show properties"}
              onClick={() => setShowProperties((current) => !current)}
              className="ml-auto h-7 gap-1 px-2 text-xs text-muted-foreground"
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Properties</span>
              {showProperties ? (
                <ChevronUp size={13} aria-hidden="true" />
              ) : (
                <ChevronDown size={13} aria-hidden="true" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Connections"
              aria-expanded={showConnections}
              aria-controls="record-connections"
              onClick={() => setShowConnections((current) => !current)}
              title="Connections"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            >
              <Link2 size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Connections</span>
              {showConnections ? (
                <ChevronUp size={13} aria-hidden="true" />
              ) : (
                <ChevronDown size={13} aria-hidden="true" />
              )}
            </Button>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">DATABASE RECORD</p>
              {readOnly ? (
                <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight sm:text-4xl">
                  {title || "Untitled"}
                </h1>
              ) : (
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  onBlur={() => void saveTitle()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  aria-label="Record title"
                  className="mt-2 w-full min-w-0 bg-transparent text-3xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-4xl"
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
                {readOnly ? "View only" : saving ? "Saving…" : "Saved"}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setViewMode(!readOnly)}
                aria-pressed={readOnly}
              >
                {readOnly ? <Pencil size={15} /> : <Eye size={15} />}
                {readOnly ? "Edit mode" : "View mode"}
              </Button>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={deleting || saving}
                  onClick={() => setConfirmDelete(true)}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 size={15} /> Delete
                </Button>
              )}
            </div>
          </div>
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {showConnections && (
          <RecordConnections recordId={record.id} backlinks={backlinks} readOnly={readOnly} />
        )}

        <section className="space-y-4">
          {record.pageId ? (
            <PageEditorLoader
              id={record.pageId}
              hideTitle
              readOnly={readOnly}
              hidePageConnections
              pageProperties={propertiesPanel}
              pagePropertiesHidden={!showProperties}
            />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Preparing this record’s page…</p>
              {propertiesPanel}
            </div>
          )}
        </section>
      </div>

      {!readOnly && (
      <AlertDialog open={confirmDelete} onOpenChange={(open) => setConfirmDelete(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{record.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The record will be deleted. Its page stays in the workspace, so its content is not lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                setConfirmDelete(false);
                void deleteRecord();
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Delete record
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      )}
      {editingButtonProperty && (
        <ButtonSettingsDialog
          onOpenChange={(open) => { if (!open) setEditingButtonProperty(null); }}
          databaseId={databaseId}
          property={editingButtonProperty}
          onSaved={(updated) => {
            setProperties((current) => current.map((property) => property.id === updated.id
              ? { ...property, options: { ...property.options, actions: updated.options.actions } }
              : property));
            setEditingButtonProperty(null);
          }}
        />
      )}
    </AppShell>
  );
}
