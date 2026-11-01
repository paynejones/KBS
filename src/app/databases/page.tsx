"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Database, Plus, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

type DatabaseSummary = { id: string; name: string; description: string; updatedAt: string };

export default function DatabasesPage() {
  const router = useRouter();
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  async function loadDatabases() {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/databases");
      if (!response.ok) throw new Error("Could not load databases.");
      setDatabases(await response.json());
    } catch (loadError) {
      setLoadError(loadError instanceof Error ? loadError.message : "Could not load databases.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDatabases(), 0);
    return () => window.clearTimeout(timer);
  }, [retryKey]);

  async function createDatabase() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled database" }),
      });
      if (!response.ok) throw new Error("Could not create database.");
      const database: { id: string } = await response.json();
      router.push(`/databases/${database.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create database.");
      setBusy(false);
    }
  }

  async function deleteDatabase(database: DatabaseSummary) {
    if (!window.confirm(`Delete “${database.name}” and all its records?`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${database.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete database.");
      setDatabases((current) => current.filter((item) => item.id !== database.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete database.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">YOUR WORKSPACE</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Databases</h1>
            <p className="mt-2 text-muted-foreground">Structured collections for the things you track.</p>
          </div>
          <Button className="w-full sm:w-auto" onClick={() => void createDatabase()} disabled={busy}><Plus size={16} /> New database</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {loading ? (
          <div role="status" aria-label="Loading databases" className="animate-pulse divide-y rounded-lg border">
            {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-[58px] bg-muted/20" />)}
          </div>
        ) : loadError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setRetryKey((current) => current + 1)}>Try again</Button>
          </div>
        ) : databases.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Database className="mx-auto text-muted-foreground" size={24} />
            <p className="mt-3 font-medium">No databases yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create a database to organize structured information.</p>
            <Button variant="outline" className="mt-4" onClick={() => void createDatabase()} disabled={busy}><Plus size={16} /> Create database</Button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {databases.map((database) => (
              <div key={database.id} className="group flex min-w-0 items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/25 hover:bg-accent/20 sm:p-5">
                <Link href={`/databases/${database.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Database size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium tracking-tight group-hover:text-primary">{database.name}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">Updated {new Date(database.updatedAt).toLocaleDateString()}</span>
                  </span>
                </Link>
                <Button type="button" variant="ghost" size="icon" disabled={busy} onClick={() => void deleteDatabase(database)} aria-label={`Delete ${database.name}`} title="Delete database"><Trash2 size={16} /></Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
