"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FILTER_OPERATORS,
  filterNeedsValue,
  isFilterableProperty,
  operatorsForProperty,
  type ViewFilter,
  type ViewFilterOperator,
  type ViewSort,
  type ViewProperty,
} from "@/lib/database-view";

type FilterableProperty = ViewProperty & { options?: Record<string, unknown> };

function newFilterId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `filter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function inputTypeFor(type: string) {
  if (type === "date") return "date";
  if (type === "number") return "number";
  return "text";
}

export function DatabaseViewControls({
  properties,
  filterText,
  filters,
  sorts,
  recordCount,
  onFilterTextChange,
  onFiltersChange,
  onSortsChange,
}: {
  properties: FilterableProperty[];
  filterText: string;
  filters: ViewFilter[];
  sorts: ViewSort[];
  recordCount: number;
  onFilterTextChange: (value: string) => void;
  onFiltersChange: (filters: ViewFilter[]) => void;
  onSortsChange: (sorts: ViewSort[]) => void;
}) {
  const filterableProperties = properties.filter((property) => isFilterableProperty(property.type));
  const sortableProperties = properties.filter((property) => property.type !== "relation");

  function addFilter() {
    const property = filterableProperties[0];
    if (!property) return;
    onFiltersChange([
      ...filters,
      {
        id: newFilterId(),
        propertyId: property.id,
        operator: operatorsForProperty(property.type)[0],
        value: "",
      },
    ]);
  }

  function updateFilter(id: string, changes: Partial<ViewFilter>) {
    onFiltersChange(filters.map((filter) => filter.id === id ? {
      ...filter,
      ...changes,
      ...(changes.propertyId !== undefined && changes.propertyId !== filter.propertyId
        ? { operator: operatorsForProperty(properties.find((property) => property.id === changes.propertyId)?.type ?? "text")[0], value: "" }
        : {}),
    } : filter));
  }

  function removeFilter(id: string) {
    onFiltersChange(filters.filter((filter) => filter.id !== id));
  }

  function addSort() {
    const used = new Set(sorts.map((sort) => sort.propertyId));
    const next = sortableProperties.find((property) => !used.has(property.id));
    onSortsChange([
      ...sorts,
      { propertyId: used.has("title") && next ? next.id : "title", direction: "asc" },
    ]);
  }

  function updateSort(index: number, changes: Partial<ViewSort>) {
    onSortsChange(sorts.map((sort, position) => position === index ? { ...sort, ...changes } : sort));
  }

  function removeSort(index: number) {
    if (sorts.length <= 1) return;
    onSortsChange(sorts.filter((_, position) => position !== index));
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Search
          <input
            type="search"
            value={filterText}
            onChange={(event) => onFilterTextChange(event.target.value)}
            placeholder="Search rows…"
            className="w-56 rounded-md border bg-background px-3 py-2"
          />
        </label>
        <Button type="button" variant="outline" size="sm" onClick={addFilter} disabled={filterableProperties.length === 0}>
          <Plus size={15} /> Filter
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={addSort} disabled={sorts.length >= 3}>
          <Plus size={15} /> Sort
        </Button>
        <span className="text-xs text-muted-foreground">
          {recordCount} {recordCount === 1 ? "record" : "records"}
          {filters.length > 0 && ` · ${filters.length} ${filters.length === 1 ? "filter" : "filters"}`}
        </span>
      </div>

      {filters.length > 0 && (
        <ul className="space-y-2 border-t pt-3">
          {filters.map((filter) => {
            const property = properties.find((candidate) => candidate.id === filter.propertyId);
            const choices = Array.isArray(property?.options?.choices)
              ? property.options.choices.filter((choice): choice is string => typeof choice === "string")
              : [];

            return (
              <li key={filter.id} className="flex flex-wrap items-center gap-2 text-sm">
                <select
                  aria-label="Filter property"
                  value={filter.propertyId}
                  onChange={(event) => updateFilter(filter.id, { propertyId: event.target.value })}
                  className="rounded-md border bg-background px-2 py-1.5"
                >
                  {filterableProperties.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter operator"
                  value={filter.operator}
                  onChange={(event) => updateFilter(filter.id, { operator: event.target.value as ViewFilterOperator })}
                  className="rounded-md border bg-background px-2 py-1.5"
                >
                  {operatorsForProperty(property?.type ?? "text").map((operator) => (
                    <option key={operator} value={operator}>{FILTER_OPERATORS[operator]}</option>
                  ))}
                </select>
                {filterNeedsValue(filter.operator) && (
                  choices.length > 0 ? (
                    <select
                      aria-label="Filter value"
                      value={filter.value}
                      onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                      className="min-w-40 rounded-md border bg-background px-2 py-1.5"
                    >
                      <option value="">Choose a value…</option>
                      {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                    </select>
                  ) : (
                    <input
                      aria-label="Filter value"
                      type={inputTypeFor(property?.type ?? "text")}
                      value={filter.value}
                      onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                      placeholder="Value"
                      className="w-40 rounded-md border bg-background px-2 py-1.5"
                    />
                  )
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeFilter(filter.id)}
                  aria-label="Remove filter"
                  title="Remove filter"
                >
                  <X size={15} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {sorts.length > 0 && (
        <ul className="space-y-2 border-t pt-3">
          {sorts.map((sort, index) => (
            <li key={`${sort.propertyId}:${index}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{index === 0 ? "Sort by" : "then"}</span>
              <select
                aria-label={index === 0 ? "Sort property" : "Secondary sort property"}
                value={sort.propertyId}
                onChange={(event) => updateSort(index, { propertyId: event.target.value })}
                className="max-w-52 rounded-md border bg-background px-2 py-1.5"
              >
                <option value="title">Name</option>
                {sortableProperties.map((property) => (
                  <option key={property.id} value={property.id}>{property.name}</option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updateSort(index, { direction: sort.direction === "asc" ? "desc" : "asc" })}
                aria-label={`Sort ${sort.direction === "asc" ? "descending" : "ascending"}`}
              >
                {sort.direction === "asc" ? "Ascending ↑" : "Descending ↓"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeSort(index)}
                disabled={sorts.length <= 1}
                aria-label="Remove sort"
                title={sorts.length <= 1 ? "Keep at least one sort" : "Remove sort"}
              >
                <X size={15} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
