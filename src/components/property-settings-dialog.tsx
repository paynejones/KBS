"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react";
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
  DATABASE_PROPERTY_TYPE_LABELS,
  MAX_PROPERTY_CHOICES,
  propertyChoices,
  ROLLUP_AGGREGATIONS,
  type DatabasePropertyType,
  type RollupAggregation,
} from "@/lib/database-property";
import { MAX_FORMULA_LENGTH } from "@/lib/database-formula";

export type EditableProperty = {
  id: string;
  name: string;
  type: string;
  options?: { choices?: string[]; [key: string]: unknown };
};

export type RollupSettings = {
  relationPropertyId: string;
  aggregation: RollupAggregation;
  targetPropertyId?: string;
};

/** The changes a save wrote, so the caller can merge them without a reload. */
export type PropertyChanges = {
  name?: string;
  choices?: string[];
  expression?: string;
  rollup?: RollupSettings;
};

function typeLabel(type: string) {
  return DATABASE_PROPERTY_TYPE_LABELS[type as DatabasePropertyType] ?? type;
}

/**
 * Rename, reorder, and delete a database property, or add a choice to a Select.
 * Moves and deletes persist immediately; the name and any new choices are saved
 * together, because a rename rewrites the formulas and buttons that read it.
 */
export function PropertySettingsDialog({
  databaseId,
  property,
  properties,
  onOpenChange,
  onSaved,
  onDeleted,
  onReordered,
}: {
  databaseId: string;
  property: EditableProperty;
  properties: EditableProperty[];
  onOpenChange: (open: boolean) => void;
  onSaved: (changes: PropertyChanges) => void;
  onDeleted: (propertyId: string) => void;
  onReordered: (propertyIds: string[]) => void;
}) {
  const initialChoices = propertyChoices(property.options);
  const initialExpression = typeof property.options?.expression === "string" ? property.options.expression : "";
  const [name, setName] = useState(property.name);
  const [choices, setChoices] = useState<string[]>(initialChoices);
  const [newChoice, setNewChoice] = useState("");
  const [expression, setExpression] = useState(initialExpression);
  const [rollupRelationId, setRollupRelationId] = useState(
    typeof property.options?.relationPropertyId === "string" ? property.options.relationPropertyId : "",
  );
  const [rollupAggregation, setRollupAggregation] = useState<RollupAggregation>(
    ROLLUP_AGGREGATIONS.includes(property.options?.aggregation as RollupAggregation)
      ? property.options?.aggregation as RollupAggregation
      : "count",
  );
  const [rollupTargetId, setRollupTargetId] = useState(
    typeof property.options?.targetPropertyId === "string" ? property.options.targetPropertyId : "",
  );
  // Choices for a rollup's number property are cached with the database they
  // came from, so switching relations never shows the previous database's list.
  const [targets, setTargets] = useState<{ databaseId: string; properties: { id: string; name: string }[] } | null>(null);
  const [loadingDatabaseId, setLoadingDatabaseId] = useState("");
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const isChoiceType = property.type === "select" || property.type === "multi_select";
  const isFormula = property.type === "formula";
  const isRollup = property.type === "rollup";
  const relationProperties = properties.filter((candidate) => candidate.type === "relation");
  const relationForRollup = relationProperties.find((candidate) => candidate.id === rollupRelationId);
  const relatedDatabaseId = typeof relationForRollup?.options?.relatedDatabaseId === "string"
    ? relationForRollup.options.relatedDatabaseId
    : "";
  const index = properties.findIndex((candidate) => candidate.id === property.id);
  const canMoveLeft = index > 0;
  const canMoveRight = index !== -1 && index < properties.length - 1;
  const targetProperties = targets?.databaseId === relatedDatabaseId ? targets.properties : [];
  const targetLoading = relatedDatabaseId !== "" && loadingDatabaseId === relatedDatabaseId;

  // A rollup's number property lives in the database its relation points at, so
  // the choices are read from there rather than from this database.
  useEffect(() => {
    if (!isRollup || !relatedDatabaseId) return;
    let cancelled = false;

    async function loadTargets() {
      setLoadingDatabaseId(relatedDatabaseId);
      try {
        const response = await fetch(`/api/databases/${relatedDatabaseId}`);
        if (!response.ok) throw new Error("Could not load the related database.");
        const data: { properties?: { id: string; name: string; type: string }[] } = await response.json();
        if (cancelled) return;
        setTargets({
          databaseId: relatedDatabaseId,
          properties: (data.properties ?? [])
            .filter((candidate) => candidate.type === "number")
            .map(({ id, name: propertyName }) => ({ id, name: propertyName })),
        });
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load the related database.");
        }
      } finally {
        if (!cancelled) setLoadingDatabaseId("");
      }
    }

    void loadTargets();
    return () => {
      cancelled = true;
    };
  }, [isRollup, relatedDatabaseId]);

  function addChoice() {
    const trimmed = newChoice.trim();
    if (!trimmed) return;
    if (choices.includes(trimmed)) {
      setError(`“${trimmed}” is already a choice.`);
      return;
    }
    if (choices.length >= MAX_PROPERTY_CHOICES) {
      setError(`A property can offer at most ${MAX_PROPERTY_CHOICES} choices.`);
      return;
    }
    setError("");
    setChoices((current) => [...current, trimmed]);
    setNewChoice("");
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("A property needs a name.");
      return;
    }

    const changes: PropertyChanges = {};
    if (trimmed !== property.name) changes.name = trimmed;
    if (isChoiceType && choices.length !== initialChoices.length) changes.choices = choices;

    if (isFormula) {
      const nextExpression = expression.trim();
      if (!nextExpression) {
        setError("Enter a formula.");
        return;
      }
      if (nextExpression !== initialExpression.trim()) changes.expression = nextExpression;
    }

    if (isRollup) {
      if (!rollupRelationId) {
        setError("Choose a relation property for this rollup.");
        return;
      }
      if (rollupAggregation !== "count" && !rollupTargetId) {
        setError("Choose a number property to summarize.");
        return;
      }
      const next: RollupSettings = {
        relationPropertyId: rollupRelationId,
        aggregation: rollupAggregation,
        ...(rollupAggregation !== "count" ? { targetPropertyId: rollupTargetId } : {}),
      };
      const stored: RollupSettings = {
        relationPropertyId: typeof property.options?.relationPropertyId === "string" ? property.options.relationPropertyId : "",
        aggregation: ROLLUP_AGGREGATIONS.includes(property.options?.aggregation as RollupAggregation)
          ? property.options?.aggregation as RollupAggregation
          : "count",
        ...(typeof property.options?.targetPropertyId === "string"
          ? { targetPropertyId: property.options.targetPropertyId }
          : {}),
      };
      if (JSON.stringify(next) !== JSON.stringify(stored)) changes.rollup = next;
    }

    if (!changes.name && !changes.choices && !changes.expression && !changes.rollup) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${databaseId}/properties/${property.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Could not save this property.");
      onSaved(changes);
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this property.");
    } finally {
      setSaving(false);
    }
  }

  async function move(direction: "left" | "right") {
    const target = direction === "left" ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= properties.length) return;

    const propertyIds = properties.map((candidate) => candidate.id);
    [propertyIds[index], propertyIds[target]] = [propertyIds[target], propertyIds[index]];

    setMoving(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${databaseId}/properties/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Could not move this property.");
      onReordered(propertyIds);
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Could not move this property.");
    } finally {
      setMoving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${databaseId}/properties/${property.id}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Could not delete this property.");
      onDeleted(property.id);
      onOpenChange(false);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete this property.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Edit “{property.name}”</AlertDialogTitle>
          <AlertDialogDescription>
            {typeLabel(property.type)} property. Renaming updates the formulas and buttons that
            read this property.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <label className="grid gap-1 text-sm">
            Property name
            <input
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
              }}
              className="rounded-md border bg-background px-3 py-2"
            />
          </label>

          {isFormula && (
            <label className="grid gap-1 text-sm">
              Formula
              <input
                value={expression}
                maxLength={MAX_FORMULA_LENGTH}
                onChange={(event) => setExpression(event.target.value)}
                placeholder="{Watched} / {Total} * 100"
                className="rounded-md border bg-background px-3 py-2 font-mono text-xs"
              />
              <span className="text-xs text-muted-foreground">
                Reference number, date, rollup, and formula properties as {"{Property}"}.
                Arithmetic, parentheses, round(value, digits), dateAdd(date, days),
                daysBetween(start, end), and today() are supported; a date moves by
                whole days with + or -.
              </span>
            </label>
          )}

          {isRollup && (
            <div className="grid gap-2 rounded-lg border p-3">
              <label className="grid gap-1 text-sm">
                Relation
                <select
                  value={rollupRelationId}
                  onChange={(event) => {
                    setRollupRelationId(event.target.value);
                    setRollupTargetId("");
                  }}
                  className="rounded-md border bg-background px-3 py-2"
                >
                  <option value="">Choose a relation…</option>
                  {relationProperties.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                Calculation
                <select
                  value={rollupAggregation}
                  onChange={(event) => setRollupAggregation(event.target.value as RollupAggregation)}
                  className="rounded-md border bg-background px-3 py-2"
                >
                  <option value="count">Count linked records</option>
                  <option value="sum">Sum number</option>
                  <option value="average">Average number</option>
                  <option value="min">Minimum number</option>
                  <option value="max">Maximum number</option>
                </select>
              </label>
              {rollupAggregation !== "count" && (
                <label className="grid gap-1 text-sm">
                  Number property
                  <select
                    value={rollupTargetId}
                    onChange={(event) => setRollupTargetId(event.target.value)}
                    disabled={!relatedDatabaseId || targetLoading}
                    className="rounded-md border bg-background px-3 py-2"
                  >
                    <option value="">
                      {targetLoading ? "Loading…" : relatedDatabaseId ? "Choose a number…" : "Choose a relation first"}
                    </option>
                    {targetProperties.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                A rollup reads one number property across the records its relation links to.
              </p>
            </div>
          )}

          {isChoiceType && (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Choices</p>
              <div className="flex flex-wrap gap-1.5">
                {choices.map((choice) => (
                  <span key={choice} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {choice}
                  </span>
                ))}
                {choices.length === 0 && (
                  <span className="text-xs text-muted-foreground">No choices yet.</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  aria-label="New choice"
                  value={newChoice}
                  maxLength={100}
                  onChange={(event) => setNewChoice(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    addChoice();
                  }}
                  placeholder="Add a choice"
                  className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                />
                <Button type="button" size="sm" variant="outline" onClick={addChoice} disabled={!newChoice.trim()}>
                  <Plus size={14} aria-hidden="true" /> Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Choices can be added. Records keep the choice they already use, so a choice cannot be
                removed here.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Column order</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Position {index === -1 ? "—" : index + 1} of {properties.length}</p>
            </div>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Move this property left"
                title="Move left"
                onClick={() => void move("left")}
                disabled={moving || !canMoveLeft}
              >
                <ArrowLeft size={14} aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Move this property right"
                title="Move right"
                onClick={() => void move("right")}
                disabled={moving || !canMoveRight}
              >
                <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-destructive/30 p-3">
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-sm">
                  Delete “{property.name}”? Its column and every record value stored in it are removed.
                  This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="destructive" size="sm" onClick={() => void remove()} disabled={deleting}>
                    <Trash2 size={14} aria-hidden="true" /> {deleting ? "Deleting…" : "Delete property"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Deleting a property removes its column and every value stored in it.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={14} aria-hidden="true" /> Delete
                </Button>
              </div>
            )}
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <Button type="button" disabled={saving || moving || deleting} onClick={() => void save()}>
            {saving ? "Saving…" : "Save property"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
