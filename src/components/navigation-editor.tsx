"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addSidebarEntry,
  createSidebarSection,
  defaultNavigationPreferences,
  getNavigationSnapshot,
  getServerNavigationSnapshot,
  isNavigationKey,
  MOBILE_NAVIGATION_LIMIT,
  moveSidebarEntry,
  moveSidebarEntryTo,
  moveSidebarSection,
  moveSidebarSectionTo,
  NAVIGATION_ITEMS,
  removeSidebarEntry,
  removeSidebarSection,
  renameSidebarSection,
  setNavigationLocked,
  sidebarEntryKey,
  storeNavigationPreferences,
  subscribeToNavigation,
  toggleHiddenNavigationKey,
  toggleMobileNavigationItem,
  type SidebarEntry,
} from "@/lib/navigation";

type PageOption = { id: string; title: string };
type DatabaseOption = { id: string; name: string };

type DraggingItem =
  | { kind: "section"; id: string }
  | { kind: "entry"; key: string; sectionId: string }
  | null;

type PointerDrag = {
  pointerId: number;
  item: NonNullable<DraggingItem>;
};

type DropTarget =
  | { kind: "section"; id: string; position: "before" | "after" }
  | { kind: "entry"; sectionId: string; key: string; position: "before" | "after" }
  | { kind: "section-end"; sectionId: string }
  | null;

const DRAG_SECTION_PREFIX = "sidebar-section:";
const DRAG_ENTRY_PREFIX = "sidebar-entry:";
const DRAG_SECTION_TYPE = "application/x-kbs-sidebar-section";
const DRAG_ENTRY_TYPE = "application/x-kbs-sidebar-entry";

export function NavigationEditor({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const preferences = useSyncExternalStore(
    subscribeToNavigation,
    getNavigationSnapshot,
    getServerNavigationSnapshot,
  );
  const [pages, setPages] = useState<PageOption[]>([]);
  const [databases, setDatabases] = useState<DatabaseOption[]>([]);
  const [dragging, setDragging] = useState<DraggingItem>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<PointerDrag | null>(null);
  const pointerDropRef = useRef<DropTarget>(null);

  useEffect(() => {
    if (!open) return;

    dialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function loadOptions() {
      const [pagesResponse, databasesResponse] = await Promise.all([
        fetch("/api/pages").catch(() => null),
        fetch("/api/databases").catch(() => null),
      ]);
      const pageRows: PageOption[] =
        pagesResponse?.ok ? await pagesResponse.json() : [];
      const databaseRows: DatabaseOption[] =
        databasesResponse?.ok ? await databasesResponse.json() : [];
      if (cancelled) return;
      setPages(pageRows);
      setDatabases(databaseRows);
    }

    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // A locked sidebar cannot edit, even if a stale open request arrives.
  if (!open || preferences.locked) return null;

  const itemByKey = new Map(
    NAVIGATION_ITEMS.map((item) => [item.key, item] as const),
  );
  const pageById = new Map(pages.map((page) => [page.id, page] as const));
  const databaseById = new Map(
    databases.map((database) => [database.id, database] as const),
  );
  const hasPageTree = preferences.sections.some((section) =>
    section.entries.some((entry) => entry.kind === "page-tree"),
  );

  function updateSections(
    sections: ReturnType<typeof defaultNavigationPreferences>["sections"],
  ) {
    storeNavigationPreferences({ ...preferences, sections });
  }

  function entryLabel(entry: SidebarEntry) {
    if (entry.kind === "navigation") {
      return itemByKey.get(entry.key)?.label ?? "Destination";
    }
    if (entry.kind === "page-tree") return "Pages tree";
    if (entry.kind === "page") {
      return pageById.get(entry.id)?.title || "Page";
    }
    return databaseById.get(entry.id)?.name || "Database";
  }

  function addEntry(sectionId: string, value: string) {
    let entry: SidebarEntry | null = null;
    if (value === "page-tree") entry = { kind: "page-tree" };
    else if (value.startsWith("navigation:")) {
      const key = value.slice("navigation:".length);
      if (isNavigationKey(key)) entry = { kind: "navigation", key };
    } else if (value.startsWith("page:")) {
      entry = { kind: "page", id: value.slice("page:".length) };
    } else if (value.startsWith("database:")) {
      entry = { kind: "database", id: value.slice("database:".length) };
    }
    if (!entry) return;
    updateSections(addSidebarEntry(preferences.sections, sectionId, entry));
  }

  function clearDrag() {
    setDragging(null);
    setDropTarget(null);
  }

  function dropPosition(event: DragEvent<HTMLElement>): "before" | "after" {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  function readDraggedItem(event: DragEvent<HTMLElement>): DraggingItem {
    const sectionId = event.dataTransfer.getData(DRAG_SECTION_TYPE);
    if (sectionId) return { kind: "section", id: sectionId };
    const entryKey = event.dataTransfer.getData(DRAG_ENTRY_TYPE);
    if (entryKey) return { kind: "entry", key: entryKey, sectionId: "" };

    const value = event.dataTransfer.getData("text/plain");
    if (value.startsWith(DRAG_SECTION_PREFIX)) {
      return { kind: "section", id: value.slice(DRAG_SECTION_PREFIX.length) };
    }
    if (value.startsWith(DRAG_ENTRY_PREFIX)) {
      return {
        kind: "entry",
        key: value.slice(DRAG_ENTRY_PREFIX.length),
        sectionId: "",
      };
    }
    return dragging;
  }

  function handleSectionDragStart(
    event: DragEvent<HTMLElement>,
    sectionId: string,
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_SECTION_TYPE, sectionId);
    event.dataTransfer.setData(
      "text/plain",
      `${DRAG_SECTION_PREFIX}${sectionId}`,
    );
    setDragging({ kind: "section", id: sectionId });
    setDropTarget(null);
  }

  function handleEntryDragStart(
    event: DragEvent<HTMLElement>,
    sectionId: string,
    entryKey: string,
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_ENTRY_TYPE, entryKey);
    event.dataTransfer.setData(
      "text/plain",
      `${DRAG_ENTRY_PREFIX}${entryKey}`,
    );
    setDragging({ kind: "entry", key: entryKey, sectionId });
    setDropTarget(null);
  }

  function handleSectionDragOver(
    event: DragEvent<HTMLElement>,
    sectionId: string,
  ) {
    const draggingSection =
      dragging?.kind === "section" ||
      event.dataTransfer.types.includes(DRAG_SECTION_TYPE);
    const draggingEntry =
      dragging?.kind === "entry" ||
      event.dataTransfer.types.includes(DRAG_ENTRY_TYPE);

    if (draggingSection) {
      if (dragging?.kind === "section" && dragging.id === sectionId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget({
        kind: "section",
        id: sectionId,
        position: dropPosition(event),
      });
      return;
    }

    if (!draggingEntry) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ kind: "section-end", sectionId });
  }

  function handleSectionDrop(event: DragEvent<HTMLElement>, sectionId: string) {
    event.preventDefault();
    const item = readDraggedItem(event);
    if (!item) return;

    if (item.kind === "section") {
      updateSections(
        moveSidebarSectionTo(
          preferences.sections,
          item.id,
          sectionId,
          dropPosition(event),
        ),
      );
    } else {
      updateSections(
        moveSidebarEntryTo(
          preferences.sections,
          item.key,
          sectionId,
          null,
        ),
      );
    }
    clearDrag();
  }

  function handleEntryDragOver(
    event: DragEvent<HTMLElement>,
    sectionId: string,
    entryKey: string,
  ) {
    const draggingEntry =
      dragging?.kind === "entry" ||
      event.dataTransfer.types.includes(DRAG_ENTRY_TYPE);
    if (
      !draggingEntry ||
      (dragging?.kind === "entry" && dragging.key === entryKey)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({
      kind: "entry",
      sectionId,
      key: entryKey,
      position: dropPosition(event),
    });
  }

  function handleEntryDrop(
    event: DragEvent<HTMLElement>,
    sectionId: string,
    entryKey: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const item = readDraggedItem(event);
    if (item?.kind !== "entry") return;

    updateSections(
      moveSidebarEntryTo(
        preferences.sections,
        item.key,
        sectionId,
        entryKey,
        dropPosition(event),
      ),
    );
    clearDrag();
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLElement>,
    item: NonNullable<DraggingItem>,
  ) {
    if (event.pointerType === "mouse") return;
    event.preventDefault();
    event.stopPropagation();
    pointerDragRef.current = { pointerId: event.pointerId, item };
    pointerDropRef.current = null;
    setDragging(item);
    setDropTarget(null);

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers and some embedded browsers do not support capture.
      // Pointer move/up handlers are still attached to the handle.
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const active = pointerDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();

    const element = document.elementFromPoint(event.clientX, event.clientY);
    const sectionElement =
      element instanceof Element
        ? element.closest<HTMLElement>("[data-section-id]")
        : null;
    const sectionId = sectionElement?.dataset.sectionId;
    let target: DropTarget = null;

    if (sectionElement && sectionId) {
      if (active.item.kind === "section") {
        if (sectionId !== active.item.id) {
          const rect = sectionElement.getBoundingClientRect();
          target = {
            kind: "section",
            id: sectionId,
            position:
              event.clientY < rect.top + rect.height / 2
                ? "before"
                : "after",
          };
        }
      } else {
        const entryElement =
          element instanceof Element
            ? element.closest<HTMLElement>("[data-entry-key]")
            : null;
        const entryKey = entryElement?.dataset.entryKey;

        if (entryElement && entryKey && entryKey !== active.item.key) {
          const rect = entryElement.getBoundingClientRect();
          target = {
            kind: "entry",
            sectionId,
            key: entryKey,
            position:
              event.clientY < rect.top + rect.height / 2
                ? "before"
                : "after",
          };
        } else if (!entryKey && sectionId !== active.item.sectionId) {
          target = { kind: "section-end", sectionId };
        }
      }
    }

    pointerDropRef.current = target;
    setDropTarget(target);

    const dialog = dialogRef.current;
    if (dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientY < rect.top + 48) {
        dialog.scrollBy({ top: -12 });
      } else if (event.clientY > rect.bottom - 48) {
        dialog.scrollBy({ top: 12 });
      }
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>) {
    const active = pointerDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();

    const target = pointerDropRef.current;
    if (target) {
      if (active.item.kind === "section" && target.kind === "section") {
        updateSections(
          moveSidebarSectionTo(
            preferences.sections,
            active.item.id,
            target.id,
            target.position,
          ),
        );
      } else if (active.item.kind === "entry") {
        if (target.kind === "entry") {
          updateSections(
            moveSidebarEntryTo(
              preferences.sections,
              active.item.key,
              target.sectionId,
              target.key,
              target.position,
            ),
          );
        } else if (target.kind === "section-end") {
          updateSections(
            moveSidebarEntryTo(
              preferences.sections,
              active.item.key,
              target.sectionId,
              null,
            ),
          );
        }
      }
    }

    finishPointerDrag(event);
  }

  function finishPointerDrag(event: ReactPointerEvent<HTMLElement>) {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Capture may already be gone after a cancel or a synthetic event.
    }
    pointerDragRef.current = null;
    pointerDropRef.current = null;
    setDragging(null);
    setDropTarget(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/50 sm:items-start sm:p-4 sm:pt-[8vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="navigation-editor-heading"
        className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border bg-background shadow-2xl outline-none sm:max-h-[85vh] sm:rounded-xl"
      >
        <span
          aria-hidden="true"
          className="mx-auto mt-2 block h-1 w-10 rounded-full bg-border sm:hidden"
        />
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2
              id="navigation-editor-heading"
              className="font-semibold tracking-tight"
            >
              Edit navigation
            </h2>
            <p className="text-xs text-muted-foreground">
              Saved on this device.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation editor"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:min-w-0"
          >
            <X size={17} />
          </button>
        </div>

        <div className="space-y-6 p-4">
          <section aria-labelledby="navigation-sections-heading">
            <h3
              id="navigation-sections-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Sidebar sections
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Group destinations, pages, databases, and the Pages tree in any
              order. Drag a section by its handle, or drag an item onto
              another item or section header. The arrow buttons remain for
              keyboard use.
            </p>

            <div className="mt-3 space-y-3">
              {preferences.sections.length === 0 && (
                <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  No sections yet. Add one to start building the sidebar.
                </p>
              )}

              {preferences.sections.map((section, sectionIndex) => (
                <section
                  key={section.id}
                  aria-label={`Section ${section.name}`}
                  data-section-id={section.id}
                  data-section-name={section.name}
                  className={`rounded-lg border bg-background ${
                    dragging?.kind === "section" && dragging.id === section.id
                      ? "opacity-50"
                      : ""
                  }`}
                >
                  <div
                    onDragOver={(event) =>
                      handleSectionDragOver(event, section.id)
                    }
                    onDrop={(event) => handleSectionDrop(event, section.id)}
                    className={`relative flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5 ${
                      dropTarget?.kind === "section-end" &&
                      dropTarget.sectionId === section.id
                        ? "bg-accent"
                        : ""
                    }`}
                  >
                    {dropTarget?.kind === "section" &&
                      dropTarget.id === section.id && (
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none absolute left-0 right-0 h-0.5 bg-primary ${
                            dropTarget.position === "before"
                              ? "-top-px"
                              : "-bottom-px"
                          }`}
                        />
                      )}
                    <span
                      draggable
                      aria-hidden="true"
                      title={`Drag section ${section.name}`}
                      data-drag-handle="section"
                      onDragStart={(event) =>
                        handleSectionDragStart(event, section.id)
                      }
                      onDragEnd={clearDrag}
                      onPointerDown={(event) =>
                        handlePointerDown(event, {
                          kind: "section",
                          id: section.id,
                        })
                      }
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={finishPointerDrag}
                      onContextMenu={(event) => event.preventDefault()}
                      className="inline-flex size-11 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing sm:size-5"
                    >
                      <GripVertical size={14} className="pointer-events-none" />
                    </span>
                    <input
                      value={section.name}
                      aria-label={`Section name ${sectionIndex + 1}`}
                      onChange={(event) =>
                        updateSections(
                          renameSidebarSection(
                            preferences.sections,
                            section.id,
                            event.target.value,
                          ),
                        )
                      }
                      className="min-h-11 min-w-24 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:min-w-0"
                    />
                    <span className="ml-auto flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-label={`Move section ${section.name} up`}
                        disabled={sectionIndex === 0}
                        onClick={() =>
                          updateSections(
                            moveSidebarSection(
                              preferences.sections,
                              section.id,
                              "up",
                            ),
                          )
                        }
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 sm:min-h-0 sm:min-w-0"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move section ${section.name} down`}
                        disabled={
                          sectionIndex === preferences.sections.length - 1
                        }
                        onClick={() =>
                          updateSections(
                            moveSidebarSection(
                              preferences.sections,
                              section.id,
                              "down",
                            ),
                          )
                        }
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 sm:min-h-0 sm:min-w-0"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove section ${section.name}`}
                        onClick={() =>
                          updateSections(
                            removeSidebarSection(
                              preferences.sections,
                              section.id,
                            ),
                          )
                        }
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:min-h-0 sm:min-w-0"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  </div>

                  <ul className="space-y-1 p-2">
                    {section.entries.length === 0 && (
                      <li className="px-2 py-1 text-xs text-muted-foreground">
                        Empty section
                      </li>
                    )}
                    {section.entries.map((entry, entryIndex) => {
                      const key = sidebarEntryKey(entry);
                      const label = entryLabel(entry);
                      const hidden =
                        entry.kind === "navigation" &&
                        preferences.hidden.includes(entry.key);

                      return (
                        <li
                          key={key}
                          data-entry-key={key}
                          onDragOver={(event) =>
                            handleEntryDragOver(event, section.id, key)
                          }
                          onDrop={(event) =>
                            handleEntryDrop(event, section.id, key)
                          }
                          className={`relative flex flex-wrap items-center gap-1 rounded-md border bg-background px-1.5 py-1 ${
                            hidden ? "opacity-60" : ""
                          } ${
                            dragging?.kind === "entry" &&
                            dragging.key === key
                              ? "opacity-40"
                              : ""
                          }`}
                        >
                          {dropTarget?.kind === "entry" &&
                            dropTarget.sectionId === section.id &&
                            dropTarget.key === key && (
                              <span
                                aria-hidden="true"
                                className={`pointer-events-none absolute left-0 right-0 h-0.5 bg-primary ${
                                  dropTarget.position === "before"
                                    ? "-top-px"
                                    : "-bottom-px"
                                }`}
                              />
                            )}
                          <span
                            draggable
                            aria-hidden="true"
                            title={`Drag ${label}`}
                            data-drag-handle="entry"
                            onDragStart={(event) =>
                              handleEntryDragStart(event, section.id, key)
                            }
                            onDragEnd={clearDrag}
                            onPointerDown={(event) =>
                              handlePointerDown(event, {
                                kind: "entry",
                                key,
                                sectionId: section.id,
                              })
                            }
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={finishPointerDrag}
                            onContextMenu={(event) => event.preventDefault()}
                            className="inline-flex size-11 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing sm:size-5"
                          >
                            <GripVertical size={13} className="pointer-events-none" />
                          </span>
                          <span className="min-w-24 flex-1 truncate text-sm sm:min-w-0">
                            {label}
                          </span>
                          {hidden && (
                            <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              Hidden
                            </span>
                          )}
                          <span className="ml-auto flex items-center gap-0.5">
                          {entry.kind === "navigation" && (
                            <button
                              type="button"
                              aria-label={
                                hidden
                                  ? `Show ${label} in sidebar`
                                  : `Hide ${label} from sidebar`
                              }
                              title={
                                hidden
                                  ? `Show ${label} in sidebar`
                                  : `Hide ${label} from sidebar`
                              }
                              onClick={() =>
                                storeNavigationPreferences({
                                  ...preferences,
                                  hidden: toggleHiddenNavigationKey(
                                    preferences.hidden,
                                    entry.key,
                                  ),
                                })
                              }
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground sm:min-h-0 sm:min-w-0"
                            >
                              {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Move ${label} up`}
                            disabled={entryIndex === 0}
                            onClick={() =>
                              updateSections(
                                moveSidebarEntry(
                                  preferences.sections,
                                  section.id,
                                  key,
                                  "up",
                                ),
                              )
                            }
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 sm:min-h-0 sm:min-w-0"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${label} down`}
                            disabled={entryIndex === section.entries.length - 1}
                            onClick={() =>
                              updateSections(
                                moveSidebarEntry(
                                  preferences.sections,
                                  section.id,
                                  key,
                                  "down",
                                ),
                              )
                            }
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 sm:min-h-0 sm:min-w-0"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${label} from sidebar`}
                            onClick={() =>
                              updateSections(
                                removeSidebarEntry(
                                  preferences.sections,
                                  section.id,
                                  key,
                                ),
                              )
                            }
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:min-h-0 sm:min-w-0"
                          >
                            <X size={13} />
                          </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="border-t px-2 py-2">
                    <label className="sr-only" htmlFor={`add-${section.id}`}>
                      Add item to {section.name}
                    </label>
                    <select
                      id={`add-${section.id}`}
                      aria-label={`Add item to ${section.name}`}
                      value=""
                      onChange={(event) => {
                        addEntry(section.id, event.target.value);
                        event.currentTarget.value = "";
                      }}
                      className="min-h-11 w-full rounded-md border bg-background px-2 py-1.5 text-xs text-foreground sm:min-h-0"
                    >
                      <option value="">Add item…</option>
                      <optgroup label="Destinations">
                        {NAVIGATION_ITEMS.map((item) => (
                          <option
                            key={item.key}
                            value={`navigation:${item.key}`}
                          >
                            {item.label}
                          </option>
                        ))}
                      </optgroup>
                      {!hasPageTree && (
                        <optgroup label="Pages">
                          <option value="page-tree">Pages tree</option>
                        </optgroup>
                      )}
                      {pages.length > 0 && (
                        <optgroup label="Pinned pages">
                          {pages.map((page) => (
                            <option key={page.id} value={`page:${page.id}`}>
                              {page.title || "Untitled"}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {databases.length > 0 && (
                        <optgroup label="Pinned databases">
                          {databases.map((database) => (
                            <option
                              key={database.id}
                              value={`database:${database.id}`}
                            >
                              {database.name || "Untitled database"}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                </section>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 min-h-11 sm:min-h-0"
              onClick={() =>
                updateSections([
                  ...preferences.sections,
                  createSidebarSection(
                    `Section ${preferences.sections.length + 1}`,
                  ),
                ])
              }
            >
              <Plus size={14} /> Add section
            </Button>
          </section>

          <section aria-labelledby="navigation-mobile-heading">
            <h3
              id="navigation-mobile-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Bottom bar
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose up to {MOBILE_NAVIGATION_LIMIT} destinations. Search and
              capture stay fixed.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {NAVIGATION_ITEMS.map((item) => {
                const selected = preferences.mobile.includes(item.key);
                const full =
                  !selected &&
                  preferences.mobile.length >= MOBILE_NAVIGATION_LIMIT;

                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={selected}
                    disabled={full}
                    onClick={() =>
                      storeNavigationPreferences({
                        ...preferences,
                        mobile: toggleMobileNavigationItem(
                          preferences.mobile,
                          item.key,
                        ),
                      })
                    }
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:min-h-0 ${
                      selected
                        ? "border-primary/30 bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {selected && <Check size={12} aria-hidden="true" />}
                    {item.label}
                  </button>
                );
              })}
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              {preferences.mobile.length} of {MOBILE_NAVIGATION_LIMIT} selected
            </p>
          </section>

          <section aria-labelledby="navigation-page-visibility-heading">
            <h3
              id="navigation-page-visibility-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Page visibility
            </h3>
            <label className="mt-3 flex cursor-pointer items-start justify-between gap-3 rounded-md border bg-background px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  Database pages
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Show pages created for database records in the sidebar,
                  Pages, home, recents, and graph.
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label="Show database pages"
                checked={preferences.showDatabasePages}
                onChange={(event) =>
                  storeNavigationPreferences({
                    ...preferences,
                    showDatabasePages: event.target.checked,
                  })
                }
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
            </label>
          </section>
        </div>

        <div className="flex items-center justify-between gap-2 border-t bg-muted/40 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-0"
            onClick={() =>
              storeNavigationPreferences(defaultNavigationPreferences())
            }
          >
            <RotateCcw size={14} />
            Reset
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-0"
              onClick={() => {
                storeNavigationPreferences(setNavigationLocked(preferences, true));
                onClose();
              }}
            >
              <Lock size={14} />
              Lock navigation
            </Button>
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-0"
              onClick={onClose}
            >
              Done
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
