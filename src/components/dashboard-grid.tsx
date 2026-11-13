"use client";

import { useState, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  dashboardWidget,
  dashboardWidgetSpan,
  isDashboardWidgetId,
  reorderDashboardWidget,
  setDashboardWidgetHidden,
  setDashboardWidgetSize,
  type DashboardLayout,
  type DashboardWidgetId,
  type DashboardWidgetSpan,
} from "@/lib/dashboard-layout";

const DRAG_MIME = "application/x-kbs-dashboard-widget";

type Props = {
  layout: DashboardLayout;
  editing: boolean;
  /** A locked layout never draws edit controls or offers to start editing. */
  locked: boolean;
  /** Rendered content for every widget id; hidden widgets are not drawn. */
  widgets: Record<DashboardWidgetId, ReactNode>;
  onLayoutChange: (next: DashboardLayout) => void;
  onRequestEdit: () => void;
};

/**
 * Draws the home widgets in their saved order. In edit mode each widget gains a
 * drag handle, arrow controls, and a hide action, and a drop zone at the end
 * lets a widget move past its neighbours. Everything is persisted by the layout
 * module, so the arrangement follows this browser.
 */
export function DashboardGrid({
  layout,
  editing,
  locked,
  widgets,
  onLayoutChange,
  onRequestEdit,
}: Props) {
  const [draggedId, setDraggedId] = useState<DashboardWidgetId | null>(null);
  const [dropTarget, setDropTarget] = useState<DashboardWidgetId | "end" | null>(null);
  const visible = layout.order.filter((id) => !layout.hidden.includes(id));

  const finishDrag = () => {
    setDraggedId(null);
    setDropTarget(null);
  };

  const startDrag = (event: ReactDragEvent<HTMLElement>, id: DashboardWidgetId) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME, id);
    event.dataTransfer.setData("text/plain", id);
    setDraggedId(id);
  };

  const dropOn = (event: ReactDragEvent<HTMLElement>, beforeId: DashboardWidgetId | null) => {
    event.preventDefault();
    const raw =
      event.dataTransfer.getData(DRAG_MIME) || event.dataTransfer.getData("text/plain");
    const id = isDashboardWidgetId(raw) ? raw : draggedId;
    if (id) onLayoutChange(reorderDashboardWidget(layout, id, beforeId));
    finishDrag();
  };

  return (
    <div className="space-y-6">
      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center" role="status">
          <LayoutDashboard className="mx-auto text-muted-foreground" size={20} aria-hidden="true" />
          <p className="mt-2 text-sm font-medium">Every home widget is hidden</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Restore one below, or reset the layout to its default arrangement.
          </p>
          {!editing && !locked && (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRequestEdit}>
              Customize home
            </Button>
          )}
          {!editing && locked && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Unlock the homepage layout to restore widgets.
            </p>
          )}
        </div>
      ) : (
        <div role="list" aria-label="Home widgets" className="grid gap-6 lg:grid-cols-2">
          {visible.map((id) => {
            const definition = dashboardWidget(id);
            // Arrow moves step between visible widgets, so a hidden neighbour
            // never swallows a click. Dropping below the next widget's
            // successor lands the moved widget after it.
            const visibleIndex = visible.indexOf(id);
            const span = dashboardWidgetSpan(layout, id);
            const highlighted = dropTarget === id;
            return (
              <div
                key={id}
                role="listitem"
                data-dashboard-widget={id}
                data-widget-span={span}
                onDragOver={
                  editing
                    ? (event) => {
                        if (!draggedId) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDropTarget(id);
                      }
                    : undefined
                }
                onDragLeave={editing ? () => setDropTarget((current) => (current === id ? null : current)) : undefined}
                onDrop={editing ? (event) => dropOn(event, id) : undefined}
                className={`min-w-0 ${span === "full" ? "lg:col-span-2" : ""} ${
                  editing
                    ? `rounded-xl border border-dashed p-2 ${
                        highlighted ? "border-brand bg-brand-soft/40" : "border-border"
                      }`
                    : ""
                } ${draggedId === id ? "opacity-60" : ""}`}
              >
                {editing && (
                  <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      draggable
                      data-widget-drag={id}
                      aria-label={`Drag ${definition.label}`}
                      title="Drag to reorder"
                      onDragStart={(event) => startDrag(event, id)}
                      onDragEnd={finishDrag}
                      className="flex cursor-grab items-center gap-1 rounded-md border bg-card px-1.5 py-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
                    >
                      <GripVertical size={14} aria-hidden="true" />
                      <span className="font-medium text-foreground">{definition.label}</span>
                    </button>
                    <div className="ml-auto flex items-center gap-1">
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        Width
                        <select
                          aria-label={`Width for ${definition.label}`}
                          value={span}
                          onChange={(event) =>
                            onLayoutChange(
                              setDashboardWidgetSize(
                                layout,
                                id,
                                event.target.value as DashboardWidgetSpan,
                              ),
                            )
                          }
                          className="rounded-md border bg-background px-1 py-0.5 text-[11px] text-foreground"
                        >
                          <option value="half">Half</option>
                          <option value="full">Full</option>
                        </select>
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Move ${definition.label} up`}
                        title="Move up"
                        disabled={visibleIndex <= 0}
                        onClick={() =>
                          onLayoutChange(
                            reorderDashboardWidget(layout, id, visible[visibleIndex - 1]),
                          )
                        }
                      >
                        <ArrowUp size={14} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Move ${definition.label} down`}
                        title="Move down"
                        disabled={visibleIndex === -1 || visibleIndex >= visible.length - 1}
                        onClick={() =>
                          onLayoutChange(
                            reorderDashboardWidget(layout, id, visible[visibleIndex + 2] ?? null),
                          )
                        }
                      >
                        <ArrowDown size={14} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Hide ${definition.label}`}
                        title="Hide widget"
                        onClick={() => onLayoutChange(setDashboardWidgetHidden(layout, id, true))}
                      >
                        <EyeOff size={14} aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                )}
                {widgets[id]}
              </div>
            );
          })}

          {editing && draggedId && (
            <div
              data-widget-drop-end
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget("end");
              }}
              onDragLeave={() => setDropTarget((current) => (current === "end" ? null : current))}
              onDrop={(event) => dropOn(event, null)}
              className={`flex items-center justify-center rounded-xl border border-dashed p-3 text-xs lg:col-span-2 ${
                dropTarget === "end" ? "border-brand bg-brand-soft/40 text-brand" : "border-border text-muted-foreground"
              }`}
            >
              Drop here to move it to the end
            </div>
          )}
        </div>
      )}

      {editing && layout.hidden.length > 0 && (
        <section
          aria-labelledby="hidden-widgets-heading"
          className="rounded-xl border border-dashed bg-card p-3"
        >
          <h2 id="hidden-widgets-heading" className="text-xs font-semibold">
            Hidden widgets
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Restoring a widget returns it to its saved position.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {layout.hidden.map((id) => (
              <li key={id}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onLayoutChange(setDashboardWidgetHidden(layout, id, false))}
                >
                  <Eye size={12} aria-hidden="true" />
                  Show {dashboardWidget(id).label}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
