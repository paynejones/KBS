"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Eye, Pencil, Trash2 } from "lucide-react";
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
import { FileCell } from "@/components/file-cell";
import { PageEditorLoader } from "@/components/page-editor-loader";
import { RecordBacklinks, type RecordBacklink } from "@/components/record-backlinks";
import { RecordPageLinks } from "@/components/record-links";
import { RelationCell } from "@/components/relation-cell";
import { Button } from "@/components/ui/button";
import { formatFormulaValue } from "@/lib/database-formula";
import type { DatabasePropertyType } from "@/lib/database-property";
import { formulaValue, rollupValue } from "@/lib/database-calculations";
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
type RelatedRecord = { id: string; title: string; values: Record<string, unknown> };
type RelationTargetData = { properties: Property[]; records: RelatedRecord[] };
type RecordDetail = RecordRow & {
  properties: Property[];
  backlinks: RecordBacklink[];
  database: { id: string; name: string };
};

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
        <span className="block px-3 py-2 text-sm" aria-label={`${property.name} calculated value`}>
          {formatFormulaValue(getFormulaValue(property))}
        </span>
      );
    }

    if (property.type === "rollup") {
      const rollup = getRollupValue(property);
      return (
        <span className="block px-3 py-2 text-sm" aria-label={`${property.name} calculated value`}>
          {typeof rollup === "number" ? rollup.toLocaleString() : rollup}
        </span>
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
                href={`/databases/${relatedDatabaseId}/records/${targetId}`}
                className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:border-primary/30 hover:text-primary"
              >
                {label} <ArrowUpRight size={11} aria-hidden="true" />
              </Link>
            ) : (
              <span key={targetId} className="rounded-md border bg-background px-2 py-1 text-xs">
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
        <span className="block px-3 py-2 text-sm">{value ? "Checked" : "Unchecked"}</span>
      );
    }

    if (readOnly && property.type === "multi_select") {
      const choices = Array.isArray(value)
        ? value.filter((choice): choice is string => typeof choice === "string")
        : [];
      return (
        <span className="block px-3 py-2 text-sm">
          {choices.length > 0 ? choices.join(", ") : <span className="text-muted-foreground">—</span>}
        </span>
      );
    }

    if (readOnly) {
      const currentValue = value === null || value === undefined || value === ""
        ? ""
        : String(value);
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
        <span className="block whitespace-pre-wrap break-words px-3 py-2 text-sm">
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
        <select
          multiple
          aria-label={property.name}
          value={Array.isArray(value) ? value.filter((choice): choice is string => typeof choice === "string") : []}
          onChange={(event) =>
            updateValue(property.id, Array.from(event.currentTarget.selectedOptions, (option) => option.value))
          }
          className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          {(property.options.choices ?? []).map((choice) => (
            <option key={choice} value={choice}>{choice}</option>
          ))}
        </select>
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
        <div role="status" aria-label="Loading record" className="mx-auto max-w-4xl animate-pulse space-y-6">
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
        <div role="alert" className="mx-auto max-w-4xl space-y-3 rounded-lg border border-destructive/30 p-4">
          <p className="text-sm text-destructive">{error || "Record not found."}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => router.push(`/databases/${databaseId}`)}>
            Back to database
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-8">
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

        <section aria-labelledby="record-properties-heading" className="rounded-xl border bg-card p-4 sm:p-6">
          <h2
            id="record-properties-heading"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Properties
          </h2>
          {properties.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">This database has no properties yet.</p>
          ) : (
            <dl className="mt-4 grid gap-5 sm:grid-cols-2">
              {properties.map((property) => (
                <div key={property.id} className="min-w-0 space-y-1.5">
                  <dt className="flex items-center gap-2 text-sm font-medium">
                    {property.name}
                    <span className="rounded border px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
                      {property.type.replace("_", " ")}
                    </span>
                  </dt>
                  <dd className="min-w-0">{renderProperty(property)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <RecordBacklinks backlinks={backlinks} />

        <RecordPageLinks recordId={record.id} readOnly={readOnly} />

        <section aria-labelledby="record-page-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <h2
              id="record-page-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Page content
            </h2>
            {record.pageId && (
              <Link
                href={`/pages/${record.pageId}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Open standalone page <ArrowUpRight size={13} />
              </Link>
            )}
          </div>
          {record.pageId ? (
            <PageEditorLoader id={record.pageId} hideTitle readOnly={readOnly} />
          ) : (
            <p className="text-sm text-muted-foreground">Preparing this record’s page…</p>
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
