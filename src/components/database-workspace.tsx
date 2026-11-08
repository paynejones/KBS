"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, CopyPlus, Download, Eye, EyeOff, Plus, Trash2, Upload } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { DatabaseCalendar } from "@/components/database-calendar";
import { FileCell } from "@/components/file-cell";
import { MediaImage } from "@/components/media-image";
import { DatabaseViewControls } from "@/components/database-view-controls";
import { ViewPropertiesMenu } from "@/components/view-properties-menu";
import { Button } from "@/components/ui/button";
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
import {
  appendedViewName,
  applyView,
  parseViewFilters,
  parseViewSorts,
  parseVisibleProperties,
  reorderedViewIds,
  visiblePropertyList,
  type ViewFilter,
  type ViewProperty,
  type ViewSort,
} from "@/lib/database-view";
import { formatFormulaValue } from "@/lib/database-formula";
import { formulaValue, rollupValue } from "@/lib/database-calculations";
import { getDashboardWidgetsSnapshot } from "@/lib/dashboard";
import {
  isImageMimeType,
  parseFilePropertyValue,
  type FilePropertyValue,
} from "@/lib/media";
import { DateCell, SelectCell } from "@/components/database-cell-editors";

type PropertyType = "text" | "number" | "checkbox" | "date" | "url" | "select" | "multi_select" | "relation" | "rollup" | "formula" | "file";
type Property = { id: string; name: string; type: PropertyType; options: { choices?: string[]; relatedDatabaseId?: string; relationPropertyId?: string; targetPropertyId?: string; aggregation?: string; expression?: string } };
type RecordRow = { id: string; title: string; values: Record<string, unknown>; pageId: string | null; relations: Record<string, string[]> };
type PageOption = { id: string; title: string };
type RelatedRecordOption = { id: string; title: string; values: Record<string, unknown> };
type DatabaseOption = { id: string; name: string };
type RelationTargetData = { properties: Property[]; records: RelatedRecordOption[] };
type DatabaseView = { id: string; name: string; type: string; config: Record<string, unknown> };
type DatabaseTemplate = { id: string; name: string; title: string; values: Record<string, unknown> };
type DatabaseData = { id: string; name: string; properties: Property[]; records: RecordRow[]; views: DatabaseView[]; templates: DatabaseTemplate[] };
type ViewUsage = {
  pages: { id: string; title: string }[];
  templates: { id: string; name: string }[];
  dashboardPinned: boolean;
};

function viewControlsFromConfig(config: Record<string, unknown> | undefined) {
  return {
    filterText: typeof config?.filterText === "string" ? config.filterText : "",
    filters: parseViewFilters(config),
    sorts: parseViewSorts(config),
  };
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  let text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function DatabaseWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const [database, setDatabase] = useState<DatabaseData | null>(null);
  const [pages, setPages] = useState<PageOption[]>([]);
  const [allDatabases, setAllDatabases] = useState<DatabaseOption[]>([]);
  const [relationTargets, setRelationTargets] = useState<Record<string, RelationTargetData>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [showPropertyForm, setShowPropertyForm] = useState(false);
  const [propertyName, setPropertyName] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyType>("text");
  const [propertyChoices, setPropertyChoices] = useState("");
  const [relatedDatabaseId, setRelatedDatabaseId] = useState("");
  const [rollupRelationPropertyId, setRollupRelationPropertyId] = useState("");
  const [rollupTargetPropertyId, setRollupTargetPropertyId] = useState("");
  const [rollupAggregation, setRollupAggregation] = useState("count");
  const [formulaExpression, setFormulaExpression] = useState("");
  const [filterText, setFilterText] = useState("");
  const [filters, setFilters] = useState<ViewFilter[]>([]);
  const [sorts, setSorts] = useState<ViewSort[]>(parseViewSorts(undefined));
  const [viewSaveError, setViewSaveError] = useState("");
  const [activeViewId, setActiveViewId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [viewPendingDelete, setViewPendingDelete] = useState<DatabaseView | null>(null);
  const [coverPendingRemoval, setCoverPendingRemoval] = useState<{ recordId: string; propertyId: string; title: string } | null>(null);
  const [recordPendingDelete, setRecordPendingDelete] = useState<RecordRow | null>(null);
  const [templatePendingDelete, setTemplatePendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [confirmDatabaseDelete, setConfirmDatabaseDelete] = useState(false);
  const [viewUsage, setViewUsage] = useState<ViewUsage | null>(null);
  const [viewUsageLoading, setViewUsageLoading] = useState(false);
  const [viewUsageError, setViewUsageError] = useState("");
  const [viewDeleteBusy, setViewDeleteBusy] = useState(false);
  const [viewDeleteError, setViewDeleteError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const csvInputRef = useRef<HTMLInputElement>(null);

  const loadDatabase = useCallback(async () => {
    try {
      const [response, pagesResponse, databasesResponse] = await Promise.all([
        fetch(`/api/databases/${id}`),
        // Record pages are reached through their record, so they are not
        // offered as a record's linked page.
        fetch("/api/pages"),
        fetch("/api/databases"),
      ]);
      if (!response.ok) throw new Error(response.status === 404 ? "Database not found." : "Could not load database.");
      if (!pagesResponse.ok) throw new Error("Could not load pages for record links.");
      if (!databasesResponse.ok) throw new Error("Could not load databases for relation properties.");
      const [loadedDatabase, pageOptions, databaseOptions]: [DatabaseData, PageOption[], DatabaseOption[]] = await Promise.all([
        response.json(),
        pagesResponse.json(),
        databasesResponse.json(),
      ]);
      setDatabase(loadedDatabase);
      setPages(pageOptions);
      setAllDatabases(databaseOptions);
      const relationProperties = loadedDatabase.properties.filter((property) => property.type === "relation" && property.options.relatedDatabaseId);
      const relatedOptions = await Promise.all(relationProperties.map(async (property) => {
        const relatedId = property.options.relatedDatabaseId!;
        if (relatedId === id) {
          return [property.id, {
            properties: loadedDatabase.properties,
            records: loadedDatabase.records.map(({ id: recordId, title, values }) => ({ id: recordId, title, values })),
          }] as const;
        }
        const relatedResponse = await fetch(`/api/databases/${relatedId}`);
        if (!relatedResponse.ok) return [property.id, { properties: [], records: [] }] as const;
        const relatedDatabase: DatabaseData = await relatedResponse.json();
        return [property.id, {
          properties: relatedDatabase.properties,
          records: relatedDatabase.records.map(({ id: recordId, title, values }) => ({ id: recordId, title, values })),
        }] as const;
      }));
      setRelationTargets(Object.fromEntries(relatedOptions));
      const requestedViewId = new URLSearchParams(window.location.search).get("view");
      const initialView = loadedDatabase.views.find((view) => view.id === requestedViewId)
        ?? loadedDatabase.views.find((view) => view.type === "table")
        ?? loadedDatabase.views[0];
      setActiveViewId(initialView?.id ?? "");
      const controls = viewControlsFromConfig(initialView?.config);
      setFilterText(controls.filterText);
      setFilters(controls.filters);
      setSorts(controls.sorts);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load database.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const view = database?.views.find((candidate) => candidate.id === activeViewId);
    if (!view) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/databases/${id}/views/${view.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { ...view.config, filterText, filters, sorts },
        }),
      }).then((response) => {
        if (!response.ok) setViewSaveError("View settings could not be saved.");
        else setViewSaveError("View saved");
      }).catch(() => setViewSaveError("View settings could not be saved."));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeViewId, database?.views, filterText, filters, id, sorts]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDatabase(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDatabase, reloadKey]);

  async function renameDatabase(name: string) {
    if (!name.trim() || !database || name === database.name) return;
    setError("");
    const response = await fetch(`/api/databases/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!response.ok) setError("Could not save database name.");
    else setDatabase((current) => current ? { ...current, name: name.trim() } : current);
  }

  async function addRecord() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${id}/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled" }),
      });
      if (!response.ok) throw new Error("Could not add record.");
      const record: RecordRow = await response.json();
      setDatabase((current) => current ? { ...current, records: [...current.records, record] } : current);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not add record.");
    } finally {
      setBusy(false);
    }
  }

  async function createFromTemplate() {
    if (!selectedTemplateId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${id}/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: selectedTemplateId }),
      });
      if (!response.ok) throw new Error("Could not create record from template.");
      const record: RecordRow = await response.json();
      setDatabase((current) => current ? { ...current, records: [...current.records, record] } : current);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create record from template.");
    } finally {
      setBusy(false);
    }
  }

  async function saveRecordAsTemplate(record: RecordRow) {
    const name = window.prompt("Name this template:", record.title)?.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${id}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, title: record.title, values: record.values }),
      });
      if (!response.ok) throw new Error("Could not save template.");
      const template: DatabaseTemplate = await response.json();
      setDatabase((current) => current ? { ...current, templates: [...current.templates, template] } : current);
      setSelectedTemplateId(template.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save template.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelectedTemplate(templateId = selectedTemplateId) {
    const template = database?.templates.find((item) => item.id === templateId);
    if (!template) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${id}/templates/${template.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete template.");
      setDatabase((current) => current ? { ...current, templates: current.templates.filter((item) => item.id !== template.id) } : current);
      setSelectedTemplateId("");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete template.");
    } finally {
      setBusy(false);
    }
  }

  async function importCsv(file: File) {
    setBusy(true);
    setImportMessage("");
    setImportError("");
    try {
      const response = await fetch(`/api/databases/${id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: await file.text() }),
      });
      const result = (await response.json().catch(() => null)) as
        | { created?: number; propertiesCreated?: string[]; skippedRows?: number; skippedCells?: number; error?: string }
        | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not import this CSV.");
      const created = result?.created ?? 0;
      const parts = [`Imported ${created} ${created === 1 ? "record" : "records"}`];
      const createdProperties = result?.propertiesCreated?.length ?? 0;
      if (createdProperties > 0) parts.push(`created ${createdProperties} ${createdProperties === 1 ? "property" : "properties"}`);
      if (result?.skippedRows) parts.push(`skipped ${result.skippedRows} empty ${result.skippedRows === 1 ? "row" : "rows"}`);
      if (result?.skippedCells) parts.push(`left ${result.skippedCells} ${result.skippedCells === 1 ? "value" : "values"} blank`);
      setImportMessage(`${parts.join("; ")}.`);
      await loadDatabase();
    } catch (importFailure) {
      setImportError(importFailure instanceof Error ? importFailure.message : "Could not import this CSV.");
    } finally {
      setBusy(false);
    }
  }

  async function addProperty() {
    const name = propertyName.trim();
    if (!name) return;
    const choices = propertyChoices.split(",").map((choice) => choice.trim()).filter(Boolean);
    if (["select", "multi_select"].includes(propertyType) && choices.length === 0) {
      setError("Add at least one comma-separated choice.");
      return;
    }
    if (propertyType === "relation" && !relatedDatabaseId) {
      setError("Choose a database for this relation.");
      return;
    }
    if (propertyType === "rollup" && !rollupRelationPropertyId) {
      setError("Choose a relation property for this rollup.");
      return;
    }
    if (propertyType === "rollup" && rollupAggregation !== "count" && !rollupTargetPropertyId) {
      setError("Choose a numeric property to summarize.");
      return;
    }
    if (propertyType === "formula" && !formulaExpression.trim()) {
      setError("Enter a formula.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${id}/properties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type: propertyType, options: {
          ...(propertyType === "select" || propertyType === "multi_select" ? { choices } : {}),
          ...(propertyType === "relation" ? { relatedDatabaseId } : {}),
          ...(propertyType === "rollup" ? {
            relationPropertyId: rollupRelationPropertyId,
            ...(rollupAggregation !== "count" ? { targetPropertyId: rollupTargetPropertyId } : {}),
            aggregation: rollupAggregation,
          } : {}),
          ...(propertyType === "formula" ? { expression: formulaExpression.trim() } : {}),
        } }),
      });
      if (!response.ok) throw new Error("Could not add property.");
      const property: Property = await response.json();
      setDatabase((current) => current ? { ...current, properties: [...current.properties, property] } : current);
      if (property.type === "relation" && property.options.relatedDatabaseId) {
        const relatedResponse = await fetch(`/api/databases/${property.options.relatedDatabaseId}`);
        if (relatedResponse.ok) {
          const relatedDatabase: DatabaseData = await relatedResponse.json();
          setRelationTargets((current) => ({
            ...current,
            [property.id]: {
              properties: relatedDatabase.properties,
              records: relatedDatabase.records.map(({ id: recordId, title, values }) => ({ id: recordId, title, values })),
            },
          }));
        }
      }
      setPropertyName("");
      setPropertyChoices("");
      setPropertyType("text");
      setRelatedDatabaseId("");
      setRollupRelationPropertyId("");
      setRollupTargetPropertyId("");
      setRollupAggregation("count");
      setFormulaExpression("");
      setShowPropertyForm(false);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not add property.");
    } finally {
      setBusy(false);
    }
  }

  async function addBoardView() {
    const groupProperty = database?.properties.find((property) => property.type === "select");
    if (!groupProperty) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${id}/views`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Board",
          type: "board",
          config: { groupBy: groupProperty.id },
        }),
      });
      if (!response.ok) throw new Error("Could not create board view.");
      const view: DatabaseView = await response.json();
      setDatabase((current) => current ? { ...current, views: [...current.views, view] } : current);
      selectView(view);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create board view.");
    } finally {
      setBusy(false);
    }
  }

  async function addGalleryView() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${id}/views`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Gallery", type: "gallery", config: {} }),
      });
      if (!response.ok) throw new Error("Could not create gallery view.");
      const view: DatabaseView = await response.json();
      setDatabase((current) => current ? { ...current, views: [...current.views, view] } : current);
      selectView(view);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create gallery view.");
    } finally {
      setBusy(false);
    }
  }

  async function addCalendarView() {
    const dateProperty = database?.properties.find((property) => property.type === "date");
    if (!dateProperty) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${id}/views`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Calendar",
          type: "calendar",
          config: { datePropertyId: dateProperty.id },
        }),
      });
      if (!response.ok) throw new Error("Could not create calendar view.");
      const view: DatabaseView = await response.json();
      setDatabase((current) => current ? { ...current, views: [...current.views, view] } : current);
      selectView(view);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create calendar view.");
    } finally {
      setBusy(false);
    }
  }

  function selectView(view: DatabaseView) {
    setActiveViewId(view.id);
    const controls = viewControlsFromConfig(view.config);
    setFilterText(controls.filterText);
    setFilters(controls.filters);
    setSorts(controls.sorts);
  }

  async function setCoverHidden(view: DatabaseView, recordId: string, hidden: boolean) {
    const current = Array.isArray(view.config.hiddenCoverRecordIds)
      ? view.config.hiddenCoverRecordIds.filter((id): id is string => typeof id === "string")
      : [];
    const next = hidden
      ? Array.from(new Set([...current, recordId]))
      : current.filter((id) => id !== recordId);
    await changeViewConfig(view, { hiddenCoverRecordIds: next });
  }

  async function changeViewConfig(view: DatabaseView, patch: Record<string, unknown>) {
    const config = { ...view.config, ...patch };
    setDatabase((current) => current ? {
      ...current,
      views: current.views.map((candidate) => candidate.id === view.id ? { ...candidate, config } : candidate),
    } : current);
    const response = await fetch(`/api/databases/${id}/views/${view.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    if (!response.ok) setViewSaveError("View settings could not be saved.");
    else setViewSaveError("");
  }

  async function persistViewOrder(views: DatabaseView[]) {
    const response = await fetch(`/api/databases/${id}/views/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewIds: views.map((view) => view.id) }),
    });
    setViewSaveError(response.ok ? "" : "View order could not be saved.");
  }

  async function duplicateView(view: DatabaseView) {
    if (!database || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${id}/views`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: appendedViewName(view.name),
          type: view.type,
          config: view.config,
        }),
      });
      if (!response.ok) throw new Error("Could not duplicate view.");
      const created: DatabaseView = await response.json();
      // The copy belongs beside its source, not at the end of the tab row.
      const ordered = database.views.flatMap((candidate) =>
        candidate.id === view.id ? [candidate, created] : [candidate],
      );
      setDatabase((current) => current ? { ...current, views: ordered } : current);
      selectView(created);
      await persistViewOrder(ordered);
    } catch (duplicateError) {
      setError(duplicateError instanceof Error ? duplicateError.message : "Could not duplicate view.");
    } finally {
      setBusy(false);
    }
  }

  async function moveView(view: DatabaseView, direction: "left" | "right") {
    if (!database) return;
    const ids = reorderedViewIds(database.views.map((candidate) => candidate.id), view.id, direction);
    if (ids.every((viewId, index) => viewId === database.views[index]?.id)) return;

    const byId = new Map(database.views.map((candidate) => [candidate.id, candidate]));
    const ordered = ids
      .map((viewId) => byId.get(viewId))
      .filter((candidate): candidate is DatabaseView => Boolean(candidate));
    setDatabase((current) => current ? { ...current, views: ordered } : current);
    await persistViewOrder(ordered);
  }

  async function updateRecord(record: RecordRow, changes: Partial<Pick<RecordRow, "title" | "values" | "pageId" | "relations">>) {
    const response = await fetch(`/api/databases/${id}/records/${record.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    if (!response.ok) {
      setError("Could not save record.");
      return;
    }
    const updated: RecordRow = await response.json();
    setDatabase((current) => current ? {
      ...current,
      records: current.records.map((row) => row.id === updated.id ? updated : row),
    } : current);
  }

  async function createPageForRecord(record: RecordRow) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: record.title }),
      });
      if (!response.ok) throw new Error("Could not create a page for this record.");
      const page: PageOption = await response.json();
      setPages((current) => [...current, page]);
      await updateRecord(record, { pageId: page.id });
      window.dispatchEvent(new Event("pages-updated"));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create a page for this record.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRecord(record: RecordRow) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${id}/records/${record.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete record.");
      setDatabase((current) => current ? {
        ...current,
        records: current.records.filter((row) => row.id !== record.id),
      } : current);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete record.");
    } finally {
      setBusy(false);
    }
  }

  function closeViewDeleteDialog() {
    if (viewDeleteBusy) return;
    setViewPendingDelete(null);
    setViewUsage(null);
    setViewUsageLoading(false);
    setViewUsageError("");
    setViewDeleteError("");
  }

  async function openViewDeleteDialog(view: DatabaseView) {
    if (!database || database.views.length <= 1) return;
    setViewPendingDelete(view);
    setViewUsage(null);
    setViewUsageLoading(true);
    setViewUsageError("");
    setViewDeleteError("");
    try {
      const usageResponse = await fetch(`/api/databases/${id}/views/${view.id}/usage`);
      if (!usageResponse.ok) {
        throw new Error("Could not check where this view is used. The view was not deleted.");
      }
      const usage = (await usageResponse.json()) as {
        pages?: { id: string; title: string }[];
        templates?: { id: string; name: string }[];
      };
      const pages = (usage.pages ?? []).map((page) => ({
        id: page.id,
        title: page.title.trim() || "Untitled",
      }));
      const templates = (usage.templates ?? []).map((template) => ({
        id: template.id,
        name: template.name.trim() || "Untitled template",
      }));
      setViewUsage({
        pages,
        templates,
        dashboardPinned: getDashboardWidgetsSnapshot().some((widget) => widget.viewId === view.id),
      });
    } catch (usageError) {
      setViewUsageError(usageError instanceof Error ? usageError.message : "Could not check where this view is used. The view was not deleted.");
    } finally {
      setViewUsageLoading(false);
    }
  }

  async function confirmDeleteView() {
    const view = viewPendingDelete;
    if (!view || !database || viewDeleteBusy || viewUsageLoading || viewUsageError || !viewUsage) return;
    setViewDeleteBusy(true);
    setViewDeleteError("");
    try {
      const response = await fetch(`/api/databases/${id}/views/${view.id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof result?.error === "string" ? result.error : "Could not delete view.");
      }
      const remaining = database.views.filter((candidate) => candidate.id !== view.id);
      setDatabase((current) => current ? {
        ...current,
        views: current.views.filter((candidate) => candidate.id !== view.id),
      } : current);
      if (!activeViewId || activeViewId === view.id) {
        const nextView = remaining.find((candidate) => candidate.type === "table") ?? remaining[0];
        if (nextView) selectView(nextView);
      }
      setViewPendingDelete(null);
      setViewUsage(null);
      setViewSaveError("");
    } catch (deleteError) {
      setViewDeleteError(deleteError instanceof Error ? deleteError.message : "Could not delete view.");
    } finally {
      setViewDeleteBusy(false);
    }
  }

  async function deleteDatabase() {
    if (!database) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/databases/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete database.");
      router.push("/databases");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete database.");
      setBusy(false);
    }
  }

  if (loading) return (
    <AppShell>
      <div role="status" aria-label="Loading database" className="animate-pulse space-y-6">
        <div className="h-4 w-28 rounded bg-muted" />
        <div className="h-10 w-2/3 rounded bg-muted" />
        <div className="h-9 rounded-lg border bg-muted/20" />
        <div className="h-10 rounded-lg bg-muted/30" />
        <div className="h-56 rounded-lg border bg-muted/10" />
      </div>
    </AppShell>
  );
  if (!database) return (
    <AppShell>
      <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 p-4">
        <p className="text-sm text-destructive">{error || "Database not found."}</p>
        <div className="flex gap-2">
          {error !== "Database not found." && <Button type="button" variant="outline" size="sm" onClick={() => { setError(""); setLoading(true); setReloadKey((current) => current + 1); }}>Try again</Button>}
          <Button type="button" variant="ghost" size="sm" onClick={() => router.push("/databases")}>Back to databases</Button>
        </div>
      </div>
    </AppShell>
  );

  const normalizedFilter = filterText.trim().toLocaleLowerCase();
  const activeView = database.views.find((view) => view.id === activeViewId) ?? database.views[0];
  const activeViewIndex = activeView
    ? database.views.findIndex((view) => view.id === activeView.id)
    : -1;
  const visibleProperties = visiblePropertyList(database.properties, activeView?.config);
  // Cover choices come from the view's visible file properties so the chosen
  // property always keeps its editable row on the card.
  const galleryCoverProperties = visibleProperties.filter((property) => property.type === "file");
  const galleryCoverPropertyId = typeof activeView?.config.coverPropertyId === "string" ? activeView.config.coverPropertyId : "";
  const galleryCoverProperty = galleryCoverProperties.find((property) => property.id === galleryCoverPropertyId);
  const hiddenCoverRecordIds = new Set(
    Array.isArray(activeView?.config.hiddenCoverRecordIds)
      ? activeView.config.hiddenCoverRecordIds.filter((id): id is string => typeof id === "string")
      : [],
  );
  const boardProperties = database.properties.filter((property) => property.type === "select");
  const dateProperties = database.properties.filter((property) => property.type === "date");
  const relationProperties = database.properties.filter((property) => property.type === "relation");
  const getRollupValue = (record: RecordRow, property: Property) =>
    rollupValue(record, property, relationTargets);
  const getFormulaValue = (record: RecordRow, property: Property) =>
    formulaValue(record, property, database.properties, relationTargets);
  const boardProperty = activeView?.type === "board"
    ? boardProperties.find((property) => property.id === activeView.config.groupBy) ?? boardProperties[0]
    : undefined;
  const dateViewPropertyId = typeof activeView?.config.datePropertyId === "string" ? activeView.config.datePropertyId : "";
  const valueFor = (record: RecordRow, property: ViewProperty) => {
    const matchedProperty = database.properties.find((candidate) => candidate.id === property.id);
    if (property.type === "rollup" && matchedProperty) return getRollupValue(record, matchedProperty);
    if (property.type === "formula" && matchedProperty) return getFormulaValue(record, matchedProperty);
    return record.values[property.id];
  };
  const matchingRecords = database.records.filter((record) => {
    if (!normalizedFilter) return true;
    return [record.title, ...Object.values(record.values).map((value) => Array.isArray(value) ? value.join(" ") : String(value ?? "")),
      ...database.properties.filter((property) => property.type === "rollup").map((property) => String(getRollupValue(record, property))),
      ...database.properties.filter((property) => property.type === "formula").map((property) => formatFormulaValue(getFormulaValue(record, property)))]
      .some((value) => value.toLocaleLowerCase().includes(normalizedFilter));
  });
  const visibleRecords = applyView(matchingRecords, database.properties, filters, sorts, { valueFor });

  // Record pages are not offered in the page picker, so keep a record's own
  // page in its options while that page is the current value.
  const linkedPageOptions = (record: RecordRow) =>
    record.pageId && !pages.some((page) => page.id === record.pageId)
      ? [...pages, { id: record.pageId, title: `${record.title || "Untitled"} (this record’s page)` }]
      : pages;

  function exportJson() {
    if (!database) return;
    const filename = `${database.name.replace(/[\\/:*?"<>|]/g, "-") || "database"}.json`;
    downloadFile(filename, `${JSON.stringify(database, null, 2)}\n`, "application/json;charset=utf-8");
  }

  function exportCsv() {
    if (!database) return;
    const columns = ["Name", ...database.properties.map((property) => property.name), "Linked page"];
    const rows = database.records.map((record) => [
      record.title,
      ...database.properties.map((property) => {
        if (property.type === "relation") {
          const targetNames = (record.relations?.[property.id] ?? []).map((targetId) =>
            relationTargets[property.id]?.records.find((item) => item.id === targetId)?.title ?? targetId,
          );
          return targetNames.join(" | ");
        }
        if (property.type === "rollup") return getRollupValue(record, property);
        if (property.type === "formula") return formatFormulaValue(getFormulaValue(record, property));
        return record.values[property.id];
      }),
      record.pageId
        ? pages.find((page) => page.id === record.pageId)?.title ?? record.title
        : "",
    ]);
    const csv = [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const filename = `${database.name.replace(/[\\/:*?"<>|]/g, "-") || "database"}.csv`;
    downloadFile(filename, `\uFEFF${csv}\r\n`, "text/csv;charset=utf-8");
  }

  return (
    <AppShell>
      <div className="space-y-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 flex-1 sm:min-w-96">
            <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">DATABASE / {(activeView?.type ?? "table").toLocaleUpperCase()}</p>
            <input
              aria-label="Database name"
              defaultValue={database.name}
              key={`${database.id}:${database.name}`}
              onBlur={(event) => void renameDatabase(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              className="mt-2 w-full bg-transparent text-3xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-4xl"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {database.records.length}{" "}
              {database.records.length === 1 ? "record" : "records"} ·{" "}
              {database.properties.length}{" "}
              {database.properties.length === 1 ? "property" : "properties"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
                More
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border bg-popover p-1 shadow-lg">
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    exportCsv();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Download size={15} aria-hidden="true" /> Export CSV
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    exportJson();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Download size={15} aria-hidden="true" /> Export JSON
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    csvInputRef.current?.click();
                  }}
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                >
                  <Upload size={15} aria-hidden="true" /> Import CSV
                </button>
                <div className="my-1 border-t" role="separator" />
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    if (activeView) void duplicateView(activeView);
                  }}
                  disabled={busy || !activeView}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                >
                  <CopyPlus size={15} aria-hidden="true" /> Duplicate view
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    if (activeView) void moveView(activeView, "left");
                  }}
                  disabled={busy || !activeView || activeViewIndex <= 0}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                >
                  <ArrowLeft size={15} aria-hidden="true" /> Move view left
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    if (activeView) void moveView(activeView, "right");
                  }}
                  disabled={busy || !activeView || activeViewIndex >= database.views.length - 1}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                >
                  <ArrowRight size={15} aria-hidden="true" /> Move view right
                </button>
                <div className="my-1 border-t" role="separator" />
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    if (activeView) void openViewDeleteDialog(activeView);
                  }}
                  disabled={busy || !activeView || database.views.length <= 1}
                  title={
                    !activeView
                      ? "No view selected"
                      : database.views.length <= 1
                        ? "A database must keep at least one view"
                        : `Delete the “${activeView.name}” view`
                  }
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Trash2 size={15} aria-hidden="true" /> Delete view
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setConfirmDatabaseDelete(true);
                  }}
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Trash2 size={15} aria-hidden="true" /> Delete database
                </button>
              </div>
            </details>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              aria-label="Import records from a CSV file"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importCsv(file);
              }}
            />
            <Button type="button" variant="outline" onClick={() => setShowPropertyForm((shown) => !shown)} disabled={busy}><Plus size={16} /> Add property</Button>
            <Button type="button" onClick={() => void addRecord()} disabled={busy}><Plus size={16} /> New record</Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 border-b">
          {database.views.map((view) => (
            <button
              key={view.id}
              type="button"
              onClick={() => selectView(view)}
              className={`-mb-px border-b-2 px-2.5 py-2 text-xs transition-colors ${
                activeViewId === view.id
                  ? "border-brand font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {view.name}
            </button>
          ))}
          <details className="relative">
            <summary
              aria-label="Add view"
              title="Add view"
              className="ml-1 flex cursor-pointer list-none items-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
            >
              <Plus size={14} aria-hidden="true" />
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border bg-popover p-1 shadow-lg">
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  void addBoardView();
                }}
                disabled={busy || boardProperties.length === 0}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40"
              >
                Board view
                {boardProperties.length === 0 && (
                  <span className="ml-auto text-[11px] text-muted-foreground">needs a Select property</span>
                )}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  void addGalleryView();
                }}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40"
              >
                Gallery view
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  void addCalendarView();
                }}
                disabled={busy || dateProperties.length === 0}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40"
              >
                Calendar view
                {dateProperties.length === 0 && (
                  <span className="ml-auto text-[11px] text-muted-foreground">needs a Date property</span>
                )}
              </button>
            </div>
          </details>
        </div>

        {database.templates.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
            <label className="grid gap-1 text-xs text-muted-foreground">
              Create from template
              <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} className="min-w-52 rounded-md border bg-background px-3 py-2 text-sm text-foreground">
                <option value="">Choose a template…</option>
                {database.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
            <Button type="button" size="sm" onClick={() => void createFromTemplate()} disabled={busy || !selectedTemplateId}><Plus size={15} /> Create record</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => {
              const template = database?.templates.find((item) => item.id === selectedTemplateId);
              if (template) setTemplatePendingDelete({ id: template.id, name: template.name });
            }} disabled={busy || !selectedTemplateId}><Trash2 size={15} /> Delete template</Button>
          </div>
        )}

        {showPropertyForm && (
          <form
            className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-4"
            onSubmit={(event) => { event.preventDefault(); void addProperty(); }}
          >
            <label className="grid gap-1 text-sm">
              Property name
              <input required maxLength={100} value={propertyName} onChange={(event) => setPropertyName(event.target.value)} className="rounded-md border bg-background px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm">
              Type
              <select value={propertyType} onChange={(event) => setPropertyType(event.target.value as PropertyType)} className="rounded-md border bg-background px-3 py-2">
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="checkbox">Checkbox</option>
                <option value="date">Date</option>
                <option value="url">URL</option>
                <option value="select">Select</option>
                <option value="multi_select">Multi-select</option>
                <option value="relation">Relation</option>
                <option value="rollup">Rollup</option>
                <option value="formula">Formula</option>
              </select>
            </label>
            {["select", "multi_select"].includes(propertyType) && (
              <label className="grid min-w-56 flex-1 gap-1 text-sm">
                Choices (comma-separated)
                <input required value={propertyChoices} onChange={(event) => setPropertyChoices(event.target.value)} placeholder="To do, In progress, Done" className="rounded-md border bg-background px-3 py-2" />
              </label>
            )}
            {propertyType === "relation" && (
              <label className="grid min-w-56 gap-1 text-sm">
                Related database
                <select required value={relatedDatabaseId} onChange={(event) => setRelatedDatabaseId(event.target.value)} className="rounded-md border bg-background px-3 py-2">
                  <option value="">Choose a database…</option>
                  {allDatabases.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                </select>
              </label>
            )}
            {propertyType === "rollup" && (
              <>
                <label className="grid gap-1 text-sm">
                  Relation
                  <select required value={rollupRelationPropertyId} onChange={(event) => { setRollupRelationPropertyId(event.target.value); setRollupTargetPropertyId(""); }} className="rounded-md border bg-background px-3 py-2">
                    <option value="">Choose a relation…</option>
                    {relationProperties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  Calculate
                  <select value={rollupAggregation} onChange={(event) => setRollupAggregation(event.target.value)} className="rounded-md border bg-background px-3 py-2">
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
                    <select required value={rollupTargetPropertyId} onChange={(event) => setRollupTargetPropertyId(event.target.value)} className="rounded-md border bg-background px-3 py-2">
                      <option value="">Choose a number…</option>
                      {(relationTargets[rollupRelationPropertyId]?.properties ?? []).filter((property) => property.type === "number").map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                    </select>
                  </label>
                )}
              </>
            )}
            {propertyType === "formula" && (
              <label className="grid min-w-72 flex-1 gap-1 text-sm">
                Formula
                <input
                  required
                  value={formulaExpression}
                  onChange={(event) => setFormulaExpression(event.target.value)}
                  placeholder="{Watched} / {Total} * 100"
                  className="rounded-md border bg-background px-3 py-2 font-mono text-xs"
                />
                <span className="text-xs text-muted-foreground">
                  Reference number and rollup properties as {"{Property}"}; arithmetic, parentheses, and round(value, digits) are supported.
                </span>
              </label>
            )}
            <Button type="submit" disabled={busy || !propertyName.trim()}>{busy ? "Adding…" : "Create property"}</Button>
          </form>
        )}

        {importError && <p role="alert" className="text-sm text-destructive">{importError}</p>}
        {importMessage && <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{importMessage}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {viewSaveError && <p role="status" aria-live="polite" className={`text-xs ${viewSaveError.includes("could not") ? "text-destructive" : "text-muted-foreground"}`}>{viewSaveError}</p>}

        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <DatabaseViewControls
              properties={database.properties}
              filterText={filterText}
              filters={filters}
              sorts={sorts}
              recordCount={visibleRecords.length}
              onFilterTextChange={setFilterText}
              onFiltersChange={setFilters}
              onSortsChange={setSorts}
            />
          </div>
          {activeView && (
            <ViewPropertiesMenu
              properties={database.properties}
              visibleIds={parseVisibleProperties(activeView.config)}
              onChange={(ids) => void changeViewConfig(activeView, { visibleProperties: ids })}
            />
          )}
        </div>

        {activeView?.type === "calendar" ? (
          <DatabaseCalendar
            databaseId={id}
            properties={database.properties}
            records={visibleRecords}
            datePropertyId={dateViewPropertyId}
            onDatePropertyChange={(propertyId) => void changeViewConfig(activeView, { datePropertyId: propertyId })}
          />
        ) : activeView?.type === "gallery" ? (
          <section aria-label="Gallery view" className="space-y-3">
            {galleryCoverProperties.length > 0 && (
              <label className="flex flex-wrap items-center gap-2 text-sm">
                Cover image
                <select
                  value={galleryCoverProperty?.id ?? ""}
                  onChange={(event) => void changeViewConfig(activeView, { coverPropertyId: event.target.value })}
                  className="rounded-md border bg-background px-3 py-2"
                >
                  <option value="">First image attachment</option>
                  {galleryCoverProperties.map((property) => (
                    <option key={property.id} value={property.id}>{property.name}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleRecords.map((record) => {
              const fileProperties = visibleProperties.filter((property) => property.type === "file");
              // The chosen file property supplies the cover; when it has no
              // image, the first image attachment keeps every card covered. The
              // chosen property's own editable row stays below either way.
              let cover: FilePropertyValue | null = null;
              let coverPropertyId = "";
              if (galleryCoverProperty) {
                const chosen = parseFilePropertyValue(record.values[galleryCoverProperty.id]);
                if (chosen && isImageMimeType(chosen.mimeType)) {
                  cover = chosen;
                  coverPropertyId = galleryCoverProperty.id;
                }
              }
              if (!cover) {
                for (const property of galleryCoverProperties) {
                  const file = parseFilePropertyValue(record.values[property.id]);
                  if (file && isImageMimeType(file.mimeType)) {
                    cover = file;
                    coverPropertyId = property.id;
                    break;
                  }
                }
              }
              const coverHidden = Boolean(cover) && hiddenCoverRecordIds.has(record.id);
              const filledProperties = visibleProperties.filter((property) => {
                if (property.type === "file") return false;
                if (property.type === "formula") return getFormulaValue(record, property) !== null;
                const value = record.values[property.id];
                return value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
              });
              return (
                <article key={record.id} className="flex min-h-44 flex-col overflow-hidden rounded-lg border bg-card p-4 shadow-sm">
                  {cover && !coverHidden && (
                    <div className="relative -mx-4 -mt-4 mb-3 border-b bg-muted/20">
                      <Link
                        href={`/databases/${id}/records/${record.id}`}
                        className="block"
                        aria-label={`Open ${record.title}`}
                      >
                        <MediaImage
                          src={cover.url}
                          alt={cover.alt || cover.filename || record.title}
                          className="h-36 w-full object-cover"
                        />
                      </Link>
                      <div className="absolute right-2 top-2 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (!coverPropertyId) return;
                            setCoverPendingRemoval({
                              recordId: record.id,
                              propertyId: coverPropertyId,
                              title: record.title,
                            });
                          }}
                          disabled={busy}
                          aria-label={`Remove cover for ${record.title}`}
                          title="Remove cover"
                          className="inline-flex size-7 items-center justify-center rounded-md border bg-background/90 text-muted-foreground shadow-sm hover:text-destructive disabled:opacity-50"
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void setCoverHidden(activeView, record.id, true)}
                          aria-label={`Hide cover for ${record.title}`}
                          title="Hide cover"
                          className="inline-flex items-center gap-1 rounded-md border bg-background/90 px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-sm hover:text-foreground"
                        >
                          <EyeOff size={12} aria-hidden="true" /> Hide cover
                        </button>
                      </div>
                    </div>
                  )}
                  {cover && coverHidden && (
                    <button
                      type="button"
                      onClick={() => void setCoverHidden(activeView, record.id, false)}
                      aria-label={`Show cover for ${record.title}`}
                      title="Show cover"
                      className="mb-2 inline-flex items-center gap-1 self-start text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <Eye size={12} aria-hidden="true" /> Show cover
                    </button>
                  )}
                  <div className="flex items-start gap-2">
                    <h2 className="min-w-0 flex-1 break-words text-base font-semibold">
                      <Link href={`/databases/${id}/records/${record.id}`} className="hover:text-primary hover:underline">{record.title}</Link>
                    </h2>
                    <Button type="button" variant="ghost" size="icon" disabled={busy} onClick={() => void saveRecordAsTemplate(record)} aria-label={`Save ${record.title} as a template`} title="Save as template"><CopyPlus size={15} /></Button>
                    <Button type="button" variant="ghost" size="icon" disabled={busy} onClick={() => setRecordPendingDelete(record)} aria-label={`Delete ${record.title}`} title="Delete record"><Trash2 size={15} /></Button>
                  </div>
                  {filledProperties.length > 0 ? (
                    <dl className="mt-3 space-y-2 text-sm">
                      {filledProperties.map((property) => {
                        const rawValue = record.values[property.id];
                        const displayValue = property.type === "formula"
                          ? formatFormulaValue(getFormulaValue(record, property))
                          : Array.isArray(rawValue)
                            ? rawValue.join(", ")
                            : typeof rawValue === "boolean"
                              ? rawValue ? "Yes" : "No"
                              : String(rawValue);
                        return (
                          <div key={property.id} className="flex items-start gap-3">
                            <dt className="w-24 shrink-0 text-muted-foreground">{property.name}</dt>
                            <dd className="min-w-0 break-words">{displayValue}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  ) : fileProperties.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">No property values</p>
                  ) : null}
                  {fileProperties.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {fileProperties.map((property) => (
                        <div key={property.id} className="space-y-0.5">
                          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {property.name}
                            {property.id === coverPropertyId && (
                              <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
                                Cover
                              </span>
                            )}
                          </p>
                          <FileCell
                            compact
                            label={property.name}
                            value={record.values[property.id]}
                            disabled={busy}
                            onChange={(next) =>
                              void updateRecord(record, {
                                values: { ...record.values, [property.id]: next },
                              })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {record.pageId ? (
                    <Link href={`/pages/${record.pageId}`} className="mt-auto pt-3 text-sm text-primary hover:underline">Open linked page ↗</Link>
                  ) : (
                    <Button type="button" variant="ghost" size="sm" className="mt-auto self-start px-0 pt-3" onClick={() => void createPageForRecord(record)} disabled={busy}>Create linked page</Button>
                  )}
                </article>
              );
            })}
            {visibleRecords.length === 0 && <p className="col-span-full rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No records match this filter.</p>}
            </div>
          </section>
        ) : activeView?.type === "board" ? (
          boardProperty ? (
            <section className="space-y-4" aria-label={`${boardProperty.name} board`}>
              <label className="flex items-center gap-2 text-sm">
                Group by
                <select value={boardProperty.id} onChange={(event) => void changeViewConfig(activeView, { groupBy: event.target.value })} className="rounded-md border bg-background px-3 py-2">
                  {boardProperties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                </select>
              </label>
              <div className="grid gap-4 overflow-x-auto pb-3 md:grid-flow-col md:auto-cols-[minmax(220px,1fr)]">
                {["", ...(boardProperty.options?.choices ?? [])].map((choice) => {
                  const columnRecords = visibleRecords.filter((record) => String(record.values[boardProperty.id] ?? "") === choice);
                  return (
                    <section key={choice || "__empty"} className="min-h-52 rounded-lg bg-muted/40 p-3" aria-label={`${choice || "No value"} column`}>
                      <h2 className="mb-3 flex items-center justify-between text-sm font-medium">
                        {choice || "No value"}<span className="text-xs text-muted-foreground">{columnRecords.length}</span>
                      </h2>
                      <div className="space-y-2">
                        {columnRecords.map((record) => (
                          <article key={record.id} className="space-y-2 rounded-md border bg-background p-3 shadow-sm">
                            <div className="flex items-start gap-2">
                              <h3 className="min-w-0 flex-1 break-words text-sm font-medium">
                                <Link href={`/databases/${id}/records/${record.id}`} className="hover:text-primary hover:underline">{record.title}</Link>
                              </h3>
                              <Button type="button" variant="ghost" size="icon" disabled={busy} onClick={() => void saveRecordAsTemplate(record)} aria-label={`Save ${record.title} as a template`} title="Save as template"><CopyPlus size={14} /></Button>
                              <Button type="button" variant="ghost" size="icon" disabled={busy} onClick={() => setRecordPendingDelete(record)} aria-label={`Delete ${record.title}`} title="Delete record"><Trash2 size={14} /></Button>
                            </div>
                            {record.pageId ? (
                              <Link href={`/pages/${record.pageId}`} className="block truncate text-xs text-primary hover:underline">Open linked page ↗</Link>
                            ) : (
                              <Button type="button" variant="ghost" size="sm" className="h-6 px-0 text-xs" onClick={() => void createPageForRecord(record)} disabled={busy}>Create linked page</Button>
                            )}
                            {visibleProperties.filter((property) => property.type === "file").map((property) => (
                              <div key={property.id} className="space-y-0.5">
                                <p className="text-[11px] text-muted-foreground">{property.name}</p>
                                <FileCell
                                  compact
                                  label={property.name}
                                  value={record.values[property.id]}
                                  disabled={busy}
                                  onChange={(next) =>
                                    void updateRecord(record, {
                                      values: { ...record.values, [property.id]: next },
                                    })
                                  }
                                />
                              </div>
                            ))}
                            <select
                              aria-label={`Move ${record.title} to another ${boardProperty.name} group`}
                              value={String(record.values[boardProperty.id] ?? "")}
                              onChange={(event) => void updateRecord(record, { values: { ...record.values, [boardProperty.id]: event.target.value } })}
                              className="w-full rounded border bg-background px-2 py-1.5 text-xs"
                            >
                              <option value="">No value</option>
                              {(boardProperty.options?.choices ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                          </article>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </section>
          ) : (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">This board needs a Select property. Add one, then create a new board view.</p>
          )
        ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="sticky left-0 z-10 min-w-56 border-r bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">Name</th>
                {visibleProperties.map((property) => <th key={property.id} className="min-w-44 px-3 py-2 text-xs font-medium text-muted-foreground">{property.name}</th>)}
                <th className="min-w-52 px-3 py-2 text-xs font-medium text-muted-foreground">Linked page</th>
                <th className="w-16 px-2 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((record) => (
                <tr key={record.id} className="group border-b last:border-0">
                  <td className="sticky left-0 z-[1] border-r bg-background p-1 group-hover:bg-muted/30">
                    <div className="flex items-center gap-1">
                      <input
                        aria-label="Record name"
                        defaultValue={record.title}
                        key={`${record.id}:${record.title}`}
                        onBlur={(event) => void updateRecord(record, { title: event.currentTarget.value.trim() || "Untitled" })}
                        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                        className="min-w-0 flex-1 rounded px-2 py-1.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <Link
                        href={`/databases/${id}/records/${record.id}`}
                        aria-label={`Open ${record.title} as a full page`}
                        title="Open record"
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <ArrowUpRight size={14} />
                      </Link>
                    </div>
                  </td>
                  {visibleProperties.map((property) => (
                    <td key={property.id} className="p-1">
                      {property.type === "relation" ? (
                        <select
                          multiple
                          aria-label={`${property.name} relations for ${record.title}`}
                          defaultValue={record.relations?.[property.id] ?? []}
                          key={`${record.id}:${property.id}:${JSON.stringify(record.relations?.[property.id] ?? [])}`}
                          onBlur={(event) => void updateRecord(record, { relations: {
                            ...record.relations,
                            [property.id]: Array.from(event.currentTarget.selectedOptions, (option) => option.value),
                          } })}
                          className="min-h-9 w-full rounded border-0 bg-transparent px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {(relationTargets[property.id]?.records ?? []).map((option) => <option key={option.id} value={option.id}>{option.title || "Untitled"}</option>)}
                        </select>
                      ) : property.type === "rollup" || property.type === "formula" ? (
                        <span className="block px-2 py-1.5 text-sm" aria-label={`${property.name} calculated value`}>
                          {property.type === "rollup" ? getRollupValue(record, property) : formatFormulaValue(getFormulaValue(record, property))}
                        </span>
                      ) : property.type === "checkbox" ? (
                        <input
                          type="checkbox"
                          aria-label={`${property.name} for ${record.title}`}
                          checked={Boolean(record.values[property.id])}
                          onChange={(event) => void updateRecord(record, { values: { ...record.values, [property.id]: event.currentTarget.checked } })}
                          className="ml-3 size-4 accent-primary"
                        />
                      ) : property.type === "select" ? (
                        <SelectCell
                          label={property.name}
                          recordTitle={record.title}
                          value={String(record.values[property.id] ?? "")}
                          choices={property.options?.choices ?? []}
                          onChange={(choice) =>
                            void updateRecord(record, {
                              values: { ...record.values, [property.id]: choice },
                            })
                          }
                        />
                      ) : property.type === "multi_select" ? (
                        <select
                          multiple
                          aria-label={`${property.name} for ${record.title}`}
                          defaultValue={Array.isArray(record.values[property.id]) ? record.values[property.id] as string[] : []}
                          key={`${record.id}:${property.id}:${JSON.stringify(record.values[property.id] ?? [])}`}
                          onBlur={(event) => void updateRecord(record, { values: { ...record.values, [property.id]: Array.from(event.currentTarget.selectedOptions, (option) => option.value) } })}
                          className="min-h-9 w-full rounded border-0 bg-transparent px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {(property.options?.choices ?? []).map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                        </select>
                      ) : property.type === "date" ? (
                        <DateCell
                          label={property.name}
                          recordTitle={record.title}
                          value={String(record.values[property.id] ?? "")}
                          onChange={(next) =>
                            void updateRecord(record, {
                              values: { ...record.values, [property.id]: next },
                            })
                          }
                        />
                      ) : property.type === "file" ? (
                        <FileCell
                          label={property.name}
                          value={record.values[property.id]}
                          disabled={busy}
                          onChange={(next) =>
                            void updateRecord(record, {
                              values: { ...record.values, [property.id]: next },
                            })
                          }
                        />
                      ) : (
                        <input
                          type={property.type === "number" ? "number" : property.type === "url" ? "url" : "text"}
                          aria-label={`${property.name} for ${record.title}`}
                          defaultValue={String(record.values[property.id] ?? "")}
                          key={`${record.id}:${property.id}:${String(record.values[property.id] ?? "")}`}
                          onBlur={(event) => {
                            const raw = event.currentTarget.value;
                            const value = property.type === "number" ? (raw === "" ? null : Number(raw)) : raw;
                            void updateRecord(record, { values: { ...record.values, [property.id]: value } });
                          }}
                          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                          className={`w-full rounded px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            property.type === "number" ? "text-right tabular-nums" : ""
                          }`}
                        />
                      )}
                    </td>
                  ))}
                  <td className="p-2">
                    <div className="flex min-w-48 items-center gap-2">
                      <select
                        aria-label={`Linked page for ${record.title}`}
                        value={record.pageId ?? ""}
                        onChange={(event) => void updateRecord(record, { pageId: event.target.value || null })}
                        className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5 text-xs"
                      >
                        <option value="">No linked page</option>
                        {linkedPageOptions(record).map((page) => <option key={page.id} value={page.id}>{page.title || "Untitled"}</option>)}
                      </select>
                      {record.pageId && <Link href={`/pages/${record.pageId}`} aria-label={`Open linked page for ${record.title}`} title="Open linked page" className="shrink-0 text-primary hover:underline">↗</Link>}
                      {!record.pageId && <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void createPageForRecord(record)} disabled={busy}>Create</Button>}
                    </div>
                  </td>
                  <td className="px-1">
                    <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <Button type="button" variant="ghost" size="icon" disabled={busy} onClick={() => void saveRecordAsTemplate(record)} aria-label={`Save ${record.title} as a template`} title="Save as template"><CopyPlus size={15} /></Button>
                      <Button type="button" variant="ghost" size="icon" disabled={busy} onClick={() => setRecordPendingDelete(record)} aria-label={`Delete ${record.title}`} title="Delete record"><Trash2 size={15} /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleRecords.length === 0 && (
                <tr><td colSpan={visibleProperties.length + 3} className="px-4 py-10 text-center text-muted-foreground">No records yet. Add a record to get started.</td></tr>
              )}
              <tr>
                <td colSpan={visibleProperties.length + 3} className="p-0">
                  <button
                    type="button"
                    onClick={() => void addRecord()}
                    disabled={busy}
                    className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
                  >
                    <Plus size={12} aria-hidden="true" /> New record
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        )}
      </div>

      <AlertDialog open={Boolean(viewPendingDelete)} onOpenChange={(open) => { if (!open) closeViewDeleteDialog(); }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{viewPendingDelete?.name ?? "view"}” view?</AlertDialogTitle>
            <AlertDialogDescription>
              Records and property values stay in the database. Only this saved view will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 text-sm">
            {viewUsageLoading && <p role="status" className="text-muted-foreground">Checking where this view is used…</p>}
            {viewUsageError && <p role="alert" className="text-destructive">{viewUsageError}</p>}
            {viewUsage && (
              <>
                {viewUsage.pages.length > 0 && (
                  <div>
                    <p className="font-medium">Pages using this view</p>
                    <ul className="mt-1.5 max-h-44 space-y-1 overflow-y-auto pr-1">
                      {viewUsage.pages.map((page) => (
                        <li key={page.id}>
                          <Link
                            href={`/pages/${page.id}`}
                            onClick={closeViewDeleteDialog}
                            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-primary hover:bg-accent hover:underline"
                          >
                            <span className="min-w-0 break-words">{page.title}</span>
                            <ArrowUpRight size={13} className="shrink-0" aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {viewUsage.templates.length > 0 && (
                  <div>
                    <p className="font-medium">Page templates using this view</p>
                    <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto pr-1">
                      {viewUsage.templates.map((template) => (
                        <li key={template.id}>
                          <Link
                            href={`/pages#template-${template.id}`}
                            onClick={closeViewDeleteDialog}
                            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-primary hover:bg-accent hover:underline"
                          >
                            <span className="min-w-0 break-words">Template “{template.name}”</span>
                            <ArrowUpRight size={13} className="shrink-0" aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {viewUsage.dashboardPinned && (
                  <div>
                    <p className="font-medium">Dashboard</p>
                    <Link
                      href="/"
                      onClick={closeViewDeleteDialog}
                      className="mt-1.5 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-primary hover:bg-accent hover:underline"
                    >
                      Pinned widget on the dashboard
                      <ArrowUpRight size={13} className="shrink-0" aria-hidden="true" />
                    </Link>
                  </div>
                )}
                {viewUsage.pages.length === 0 && viewUsage.templates.length === 0 && !viewUsage.dashboardPinned && (
                  <p className="rounded-md bg-muted/60 px-3 py-2 text-muted-foreground">
                    This view is not embedded in any pages or templates, or pinned to the dashboard.
                  </p>
                )}
                {(viewUsage.pages.length > 0 || viewUsage.templates.length > 0 || viewUsage.dashboardPinned) && (
                  <p className="text-xs text-muted-foreground">These references may need updating after deletion.</p>
                )}
              </>
            )}
            {viewDeleteError && <p role="alert" className="text-destructive">{viewDeleteError}</p>}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={viewDeleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void confirmDeleteView()}
              disabled={viewDeleteBusy || viewUsageLoading || !viewUsage || Boolean(viewUsageError)}
            >
              <Trash2 size={15} aria-hidden="true" />
              {viewDeleteBusy ? "Deleting…" : "Delete view"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                if (!pending) return;
                const currentRecord = database?.records.find((row) => row.id === pending.recordId);
                if (currentRecord) {
                  void updateRecord(currentRecord, {
                    values: { ...currentRecord.values, [pending.propertyId]: null },
                  });
                }
                setCoverPendingRemoval(null);
              }}
            >
              <Trash2 size={15} aria-hidden="true" /> Remove cover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(recordPendingDelete)}
        onOpenChange={(open) => { if (!open) setRecordPendingDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{recordPendingDelete?.title ?? "record"}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The record will be deleted. Its page stays in the workspace, so its content is not lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const pending = recordPendingDelete;
                setRecordPendingDelete(null);
                if (pending) void deleteRecord(pending);
              }}
            >
              <Trash2 size={15} aria-hidden="true" /> Delete record
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(templatePendingDelete)}
        onOpenChange={(open) => { if (!open) setTemplatePendingDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{templatePendingDelete?.name ?? "template"}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Records created from this template stay in the database. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const pending = templatePendingDelete;
                setTemplatePendingDelete(null);
                if (pending) void deleteSelectedTemplate(pending.id);
              }}
            >
              <Trash2 size={15} aria-hidden="true" /> Delete template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDatabaseDelete} onOpenChange={(open) => setConfirmDatabaseDelete(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{database?.name ?? "database"}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The database and all its records will be deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setConfirmDatabaseDelete(false);
                void deleteDatabase();
              }}
            >
              <Trash2 size={15} aria-hidden="true" /> Delete database
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
