"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Database, ExternalLink, Trash2 } from "lucide-react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Button } from "@/components/ui/button";

type EmbedProperty = { id: string; name: string; type: string; options?: { choices?: string[] } };
type EmbedRecord = { id: string; title: string; values: Record<string, unknown> };
type EmbedData = {
  id: string;
  name: string;
  properties: EmbedProperty[];
  records: EmbedRecord[];
  views: { id: string; name: string; type: string; config: Record<string, unknown> }[];
};

function displayValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value === undefined || value === null || value === "" ? "—" : String(value);
}

function DatabaseEmbedView({ node, deleteNode }: NodeViewProps) {
  const databaseId = String(node.attrs.databaseId ?? "");
  const viewId = String(node.attrs.viewId ?? "");
  const [data, setData] = useState<EmbedData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/databases/${databaseId}`);
        if (!response.ok) throw new Error("This database is unavailable.");
        const result: EmbedData = await response.json();
        if (!cancelled) {
          setData(result);
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
        {error ? (
          <p role="alert" className="p-4 text-sm text-destructive">{error}</p>
        ) : data ? (
          selectedView?.type === "gallery" ? (
            <div className="grid gap-3 p-3 sm:grid-cols-2">
              {data.records.slice(0, 8).map((record) => (
                <article key={record.id} className="rounded-md border p-3">
                  <h3 className="text-sm font-medium">{record.title}</h3>
                  <dl className="mt-2 space-y-1 text-xs">
                    {data.properties.slice(0, 4).map((property) => (
                      <div key={property.id} className="flex gap-2">
                        <dt className="shrink-0 text-muted-foreground">{property.name}</dt>
                        <dd className="min-w-0 truncate">{displayValue(record.values[property.id])}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
              {data.records.length === 0 && <p className="col-span-full py-5 text-center text-sm text-muted-foreground">No records yet.</p>}
              {data.records.length > 8 && <p className="col-span-full text-xs text-muted-foreground">Showing 8 of {data.records.length} records.</p>}
            </div>
          ) : selectedView?.type === "board" && boardProperty ? (
            <div className="grid gap-3 overflow-x-auto p-3 md:grid-flow-col md:auto-cols-[minmax(180px,1fr)]">
              {["", ...(boardProperty.options?.choices ?? [])].map((choice) => {
                const records = data.records.filter((record) => String(record.values[boardProperty.id] ?? "") === choice);
                return (
                  <section key={choice || "__empty"} className="min-h-36 rounded-md bg-muted/40 p-2">
                    <h3 className="mb-2 text-xs font-medium">{choice || "No value"} <span className="text-muted-foreground">{records.length}</span></h3>
                    <div className="space-y-2">
                      {records.slice(0, 8).map((record) => <div key={record.id} className="rounded border bg-background p-2 text-xs">{record.title}</div>)}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-3 py-2 font-medium">Name</th>
                  {data.properties.slice(0, 4).map((property) => <th key={property.id} className="px-3 py-2 font-medium">{property.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.records.slice(0, 8).map((record) => (
                  <tr key={record.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{record.title}</td>
                    {data.properties.slice(0, 4).map((property) => <td key={property.id} className="max-w-56 truncate px-3 py-2 text-muted-foreground">{displayValue(record.values[property.id])}</td>)}
                  </tr>
                ))}
                {data.records.length === 0 && <tr><td colSpan={Math.min(data.properties.length, 4) + 1} className="px-3 py-7 text-center text-muted-foreground">No records yet.</td></tr>}
              </tbody>
            </table>
            {data.records.length > 8 && <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing 8 of {data.records.length} records.</p>}
          </div>
          )
        ) : (
          <div className="p-5 text-sm text-muted-foreground">Loading database view…</div>
        )}
      </section>
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
