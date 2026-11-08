"use client";

type PropertyOption = { id: string; name: string };

/**
 * Per-view property visibility. The menu writes the ordered ids of the
 * properties that should stay visible, so a view can hide what it does not
 * need without changing the database or its other views.
 */
export function ViewPropertiesMenu({
  properties,
  visibleIds,
  onChange,
}: {
  properties: PropertyOption[];
  /** null shows every property, which is also how older views behave. */
  visibleIds: string[] | null;
  onChange: (ids: string[]) => void;
}) {
  const shown = new Set(visibleIds ?? properties.map((property) => property.id));
  const shownCount = properties.filter((property) => shown.has(property.id)).length;

  function toggle(propertyId: string) {
    const next = new Set(shown);
    if (next.has(propertyId)) next.delete(propertyId);
    else next.add(propertyId);
    onChange(properties.filter((property) => next.has(property.id)).map((property) => property.id));
  }

  return (
    <details className="relative">
      <summary
        title="Choose visible properties"
        className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        Properties
        <span className="tabular-nums">
          {shownCount}/{properties.length}
        </span>
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border bg-popover p-2 shadow-lg">
        <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">
          Shown in this view
        </p>
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {properties.map((property) => (
            <label
              key={property.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent"
            >
              <input
                type="checkbox"
                checked={shown.has(property.id)}
                onChange={() => toggle(property.id)}
                className="size-3.5 accent-primary"
              />
              <span className="min-w-0 truncate">{property.name}</span>
            </label>
          ))}
          {properties.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">No properties yet.</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onChange(properties.map((property) => property.id))}
          disabled={shownCount === properties.length}
          className="mt-1 w-full rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          Show all properties
        </button>
      </div>
    </details>
  );
}
