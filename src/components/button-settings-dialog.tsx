"use client";

import { useEffect, useState } from "react";
import { ButtonActionsEditor } from "@/components/button-actions-editor";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  buttonActionsError,
  type ButtonAction,
} from "@/lib/database-button";

export type ButtonSettingsProperty = {
  id: string;
  name: string;
  type: string;
  options: {
    choices?: string[];
    relatedDatabaseId?: string;
    actions?: ButtonAction[];
  };
};
type SettingsProperty = ButtonSettingsProperty;
type DatabaseOption = { id: string; name: string };
type SettingsRecord = { id: string; title: string };

export function ButtonSettingsDialog({
  onOpenChange,
  databaseId,
  property,
  onSaved,
}: {
  onOpenChange: (open: boolean) => void;
  databaseId: string;
  property: SettingsProperty;
  onSaved: (property: SettingsProperty) => void;
}) {
  const [actions, setActions] = useState<ButtonAction[]>(() => property.options.actions ?? []);
  const [properties, setProperties] = useState<SettingsProperty[]>([]);
  const [databases, setDatabases] = useState<DatabaseOption[]>([]);
  const [databaseProperties, setDatabaseProperties] = useState<Record<string, SettingsProperty[]>>({});
  const [databaseRecords, setDatabaseRecords] = useState<Record<string, SettingsRecord[]>>({});
  const [relatedProperties, setRelatedProperties] = useState<Record<string, SettingsProperty[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [databaseResponse, databasesResponse] = await Promise.all([
          fetch(`/api/databases/${databaseId}`),
          fetch("/api/databases"),
        ]);
        if (!databaseResponse.ok) throw new Error("Could not load this database.");
        if (!databasesResponse.ok) throw new Error("Could not load databases.");
        const database: { properties: SettingsProperty[]; records: SettingsRecord[] } = await databaseResponse.json();
        const databaseOptions: DatabaseOption[] = await databasesResponse.json();
        const savedActions = property.options.actions ?? [];
        const relationIds = database.properties
          .filter((candidate) => candidate.type === "relation")
          .map((candidate) => candidate.options.relatedDatabaseId)
          .filter((id): id is string => typeof id === "string");
        const createIds = savedActions
          .filter((action) => action.type === "create_record")
          .map((action) => action.databaseId);
        const recordIds = savedActions
          .filter((action) => action.type === "set_record_property")
          .map((action) => action.databaseId);
        const targetIds = [...new Set([...relationIds, ...createIds, ...recordIds])]
          .filter((targetId) => targetId !== databaseId);
        const targets = await Promise.all(targetIds.map(async (targetId) => {
          const response = await fetch(`/api/databases/${targetId}`);
          if (!response.ok) {
            return [targetId, { properties: [] as SettingsProperty[], records: [] as SettingsRecord[] }] as const;
          }
          const detail: { properties: SettingsProperty[]; records: SettingsRecord[] } = await response.json();
          return [targetId, { properties: detail.properties, records: detail.records }] as const;
        }));

        if (cancelled) return;
        const nextDatabaseProperties = new Map<string, SettingsProperty[]>([[databaseId, database.properties]]);
        const nextDatabaseRecords = new Map<string, SettingsRecord[]>([[databaseId, database.records]]);
        for (const [targetId, target] of targets) {
          nextDatabaseProperties.set(targetId, target.properties);
          nextDatabaseRecords.set(targetId, target.records);
        }
        const nextRelatedProperties: Record<string, SettingsProperty[]> = {};
        for (const relation of database.properties.filter((candidate) => candidate.type === "relation")) {
          const targetId = relation.options.relatedDatabaseId;
          if (typeof targetId === "string") {
            nextRelatedProperties[relation.id] = nextDatabaseProperties.get(targetId) ?? [];
          }
        }
        setProperties(database.properties);
        setDatabases(databaseOptions);
        setDatabaseProperties(Object.fromEntries(nextDatabaseProperties));
        setDatabaseRecords(Object.fromEntries(nextDatabaseRecords));
        setRelatedProperties(nextRelatedProperties);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load button settings.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [property, databaseId]);

  async function loadDatabase(targetId: string) {
    if (!targetId || databaseProperties[targetId]) return;
    try {
      const response = await fetch(`/api/databases/${targetId}`);
      if (!response.ok) throw new Error("Could not load the target database.");
      const detail: { properties: SettingsProperty[]; records: SettingsRecord[] } = await response.json();
      setDatabaseProperties((current) => ({ ...current, [targetId]: detail.properties }));
      setDatabaseRecords((current) => ({ ...current, [targetId]: detail.records }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the target database.");
    }
  }

  async function save() {
    const actionError = buttonActionsError(actions);
    if (actionError) {
      setError(actionError);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${databaseId}/properties/${property.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions }),
      });
      const body = await response.json().catch(() => null) as (SettingsProperty & { error?: string }) | null;
      if (!response.ok || !body) {
        throw new Error(body?.error || "Could not save button actions.");
      }
      onSaved(body);
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save button actions.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Edit “{property.name}” actions</AlertDialogTitle>
          <AlertDialogDescription>
            Changes apply to every record the next time this button runs.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {loading ? (
          <p role="status" className="py-6 text-sm text-muted-foreground">Loading button settings…</p>
        ) : properties.length > 0 ? (
          <div className="space-y-3">
            <ButtonActionsEditor
              actions={actions}
              onChange={setActions}
              properties={properties}
              relationProperties={properties
                .filter((candidate) => candidate.type === "relation" && typeof candidate.options.relatedDatabaseId === "string")
                .map((candidate) => ({
                  id: candidate.id,
                  name: candidate.name,
                  relatedDatabaseId: candidate.options.relatedDatabaseId!,
                }))}
              relatedProperties={relatedProperties}
              currentDatabaseId={databaseId}
              databases={databases}
              databaseProperties={databaseProperties}
              databaseRecords={databaseRecords}
              onLoadDatabase={(targetId) => void loadDatabase(targetId)}
            />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        ) : (
          <p role="alert" className="py-4 text-sm text-destructive">
            {error || "Could not load this button."}
          </p>
        )}

        <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <Button type="button" disabled={loading || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save actions"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
