"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageEditorLoader } from "@/components/page-editor-loader";
import { RecordPageLinks } from "@/components/record-links";
import { Button } from "@/components/ui/button";
import { evaluateFormula, formatFormulaValue, parseFormula } from "@/lib/database-formula";
import { parseFilePropertyValue } from "@/lib/media";

type Property = {
  id: string;
  name: string;
  type: string;
  options: {
    choices?: string[];
    relatedDatabaseId?: string;
    relationPropertyId?: string;
    targetPropertyId?: string;
    aggregation?: string;
    expression?: string;
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
  const [record, setRecord] = useState<RecordRow | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [databaseName, setDatabaseName] = useState("");
  const [title, setTitle] = useState("");
  const [relationTargets, setRelationTargets] = useState<Record<string, RelationTargetData>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  const propertiesByName = useMemo(
    () => new Map(properties.map((property) => [property.name, property])),
    [properties],
  );

  function getRollupValue(property: Property): number | string {
    if (!record) return "—";
    const relationPropertyId = property.options.relationPropertyId;
    const targetIds = relationPropertyId ? record.relations[relationPropertyId] ?? [] : [];
    if (property.options.aggregation === "count") return targetIds.length;
    const targetPropertyId = property.options.targetPropertyId;
    const values = targetIds
      .map((targetId) =>
        relationTargets[relationPropertyId ?? ""]?.records.find((item) => item.id === targetId)?.values[targetPropertyId ?? ""],
      )
      .map((value) => (typeof value === "number" ? value : Number(value)))
      .filter(Number.isFinite);
    if (values.length === 0) return "—";
    switch (property.options.aggregation) {
      case "sum": return values.reduce((sum, value) => sum + value, 0);
      case "average": return values.reduce((sum, value) => sum + value, 0) / values.length;
      case "min": return Math.min(...values);
      case "max": return Math.max(...values);
      default: return "—";
    }
  }

  function getFormulaValue(property: Property): number | null {
    if (!record) return null;
    const expression = typeof property.options.expression === "string" ? property.options.expression : "";
    const parsed = parseFormula(expression);
    if (!parsed.ok) return null;
    return evaluateFormula(parsed.ast, (name) => {
      const referenced = propertiesByName.get(name);
      if (!referenced) return null;
      if (referenced.type === "number") {
        const value = record.values[referenced.id];
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        const text = String(value ?? "").trim();
        const numeric = Number(text);
        return text !== "" && Number.isFinite(numeric) ? numeric : null;
      }
      if (referenced.type === "rollup") {
        const value = getRollupValue(referenced);
        return typeof value === "number" ? value : null;
      }
      return null;
    });
  }

  async function deleteRecord() {
    if (!record || !window.confirm(`Delete “${record.title}”? Its page will stay in the workspace.`)) return;
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

  function renderProperty(property: Property) {
    if (!record) return null;
    const value = record.values[property.id];

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

    if (property.type === "relation") {
      const targets = relationTargets[property.id]?.records ?? [];
      return (
        <select
          multiple
          aria-label={`${property.name} relations`}
          value={record.relations[property.id] ?? []}
          onChange={(event) =>
            updateRelations(property, Array.from(event.currentTarget.selectedOptions, (option) => option.value))
          }
          className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          {targets.map((target) => (
            <option key={target.id} value={target.id}>{target.title || "Untitled"}</option>
          ))}
        </select>
      );
    }

    if (property.type === "file") {
      const file = parseFilePropertyValue(value);
      if (file) {
        return (
          <a
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-3 py-2 text-sm text-primary hover:underline"
          >
            {file.filename || file.alt || "Open file"} <ArrowUpRight size={14} />
          </a>
        );
      }
      return (
        <span className="block px-3 py-2 text-sm text-muted-foreground">
          {file === null ? "No file" : "This file value can’t be displayed."}
        </span>
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
          <Link
            href={`/databases/${databaseId}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={15} /> {databaseName || "Database"}
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">DATABASE RECORD</p>
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
            </div>
            <div className="flex items-center gap-2">
              <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
                {saving ? "Saving…" : "Saved"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={deleting || saving}
                onClick={() => void deleteRecord()}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 size={15} /> Delete
              </Button>
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

        <RecordPageLinks recordId={record.id} />

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
            <PageEditorLoader id={record.pageId} hideTitle />
          ) : (
            <p className="text-sm text-muted-foreground">Preparing this record’s page…</p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
