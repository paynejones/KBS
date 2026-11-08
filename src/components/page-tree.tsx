
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Pencil,
  Plus,
  X,
} from "lucide-react";

type Page = {
  id: string;
  title: string;
  parentId: string | null;
};

export function PageTree() {
  const router = useRouter();

  const [pages, setPages] = useState<Page[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedLoaded, setExpandedLoaded] = useState(false);
  const [loading, setLoading] = useState(true);

  const [creatingParent, setCreatingParent] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<
    "before" | "after" | "inside" | null
  >(null);

  async function loadPages() {
    try {
      const response = await fetch("/api/pages");

      if (!response.ok) {
        throw new Error("Failed to load pages");
      }

      const data = await response.json();
      setPages(data);
    } catch (err) {
      console.error(err);
      setError("Could not load pages.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
  const timer = window.setTimeout(() => {
    try {
      const saved = localStorage.getItem("kbs-expanded-pages");

      if (saved) {
        const parsed: unknown = JSON.parse(saved);

        if (
          Array.isArray(parsed) &&
          parsed.every((id) => typeof id === "string")
        ) {
          setExpanded(new Set(parsed));
        }
      }
    } catch (error) {
      console.error("Could not restore expanded pages:", error);
    } finally {
      setExpandedLoaded(true);
    }
  }, 0);

  return () => window.clearTimeout(timer);
}, []);

useEffect(() => {
  if (!expandedLoaded) return;

  try {
    localStorage.setItem(
      "kbs-expanded-pages",
      JSON.stringify(Array.from(expanded))
    );
  } catch (error) {
    console.error("Could not save expanded pages:", error);
  }
}, [expanded, expandedLoaded]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadPages(), 0);

    function handlePagesUpdated() {
      loadPages();
    }

    window.addEventListener("pages-updated", handlePagesUpdated);

    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("pages-updated", handlePagesUpdated);
    };
  }, []);

  function toggleExpanded(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function startRenaming(page: Page) {
    setEditingId(page.id);
    setEditingTitle(page.title);
    setError("");
  }

  function cancelRenaming() {
    setEditingId(null);
    setEditingTitle("");
  }

  async function saveRename(pageId: string) {
    const title = editingTitle.trim();

    if (!title) {
      setError("Page title cannot be empty.");
      return;
    }

    setSavingId(pageId);
    setError("");

    try {
      const response = await fetch(`/api/pages/${pageId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      });

      if (!response.ok) {
        throw new Error("Failed to rename page");
      }

      setPages((previous) =>
        previous.map((page) =>
          page.id === pageId ? { ...page, title } : page
        )
      );

      setEditingId(null);
      setEditingTitle("");

      window.dispatchEvent(new Event("pages-updated"));
      router.refresh();
    } catch (err) {
      console.error(err);
      setError("Could not rename page.");
    } finally {
      setSavingId(null);
    }
  }

  async function createSubpage(parentId: string) {
    setCreatingParent(parentId);
    setError("");

    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Untitled",
          parentId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create subpage");
      }

      const newPage = await response.json();

      setExpanded((previous) => new Set(previous).add(parentId));
      await loadPages();

      window.dispatchEvent(new Event("pages-updated"));
      router.push(`/pages/${newPage.id}`);
    } catch (err) {
      console.error(err);
      setError("Could not create subpage.");
    } finally {
      setCreatingParent(null);
    }
  }

  async function reorderPage(
    pageId: string,
    direction: "up" | "down"
  ) {
    setReorderingId(pageId);
    setError("");

    try {
      const response = await fetch("/api/pages/reorder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pageId,
          direction,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to reorder page");
      }

      await loadPages();
      window.dispatchEvent(new Event("pages-updated"));
    } catch (err) {
      console.error(err);
      setError("Could not reorder page.");
    } finally {
      setReorderingId(null);
    }
  }

  function handleDragStart(
  event: React.DragEvent<HTMLDivElement>,
  pageId: string
) {
  setDraggingId(pageId);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", pageId);
}

function handleDragOver(
  event: React.DragEvent<HTMLDivElement>,
  targetId: string
) {
  event.preventDefault();

  if (!draggingId || draggingId === targetId) return;

  const target = pages.find((page) => page.id === targetId);
  if (!target) return;

  // Prevent dropping a page onto one of its descendants.
  let current = target.parentId;

  while (current) {
    if (current === draggingId) return;

    const parent = pages.find((page) => page.id === current);
    current = parent?.parentId ?? null;
  }

  const bounds = event.currentTarget.getBoundingClientRect();
  const relativeY = event.clientY - bounds.top;
  const ratio = relativeY / bounds.height;

  const position =
    ratio < 0.25 ? "before" :
    ratio > 0.75 ? "after" :
    "inside";

  setDragOverId(targetId);
  setDragPosition(position);
  event.dataTransfer.dropEffect = "move";
}

async function handleDrop(
  event: React.DragEvent<HTMLDivElement>,
  targetId?: string
) {
  event.preventDefault();

  const draggedId = event.dataTransfer.getData("text/plain");

  if (!draggedId || draggedId === targetId) {
    clearDragState();
    return;
  }

  const position = targetId ? dragPosition : null;
  const target = targetId
    ? pages.find((page) => page.id === targetId)
    : null;

  let newParentId: string | null = null;

  if (target && position === "inside") {
    newParentId = target.id;
  } else if (target) {
    newParentId = target.parentId;
  }

  try {
    const response = await fetch("/api/pages/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageId: draggedId,
        newParentId,
        targetPageId: targetId ?? null,
        position: position ?? "after",
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to move page");
    }

    if (newParentId) {
      setExpanded((previous) => new Set(previous).add(newParentId!));
    }

    await loadPages();
    window.dispatchEvent(new Event("pages-updated"));
  } catch (error) {
    console.error(error);
    setError(
      error instanceof Error ? error.message : "Could not move page."
    );
  } finally {
    clearDragState();
  }
}

function clearDragState() {
  setDraggingId(null);
  setDragOverId(null);
  setDragPosition(null);
}

  function renderPages(parentId: string | null = null, depth = 0) {
    const children = pages.filter((page) => page.parentId === parentId);

    return children.map((page, index) => {
      const hasChildren = pages.some(
        (child) => child.parentId === page.id
      );

      const isExpanded = expanded.has(page.id);
      const isEditing = editingId === page.id;
      const isSaving = savingId === page.id;
      const isReordering = reorderingId === page.id;

      return (
        <div key={page.id}>
          <div
                draggable={!isEditing}
                onDragStart={(event) => handleDragStart(event, page.id)}
                onDragEnd={clearDragState}
                onDragOver={(event) => handleDragOver(event, page.id)}
                onDrop={(event) => handleDrop(event, page.id)}
                className={`group relative flex items-center gap-1 rounded-md hover:bg-accent focus-within:bg-accent ${
                    draggingId === page.id ? "opacity-40" : ""
                } ${
                    dragOverId === page.id && dragPosition === "inside"
                    ? "bg-accent ring-2 ring-primary"
                    : ""
                }`}
                style={{ paddingLeft: `${depth * 16 + 4}px` }}
                >
                                    {dragOverId === page.id && dragPosition === "before" && (
                <div className="absolute -top-0.5 left-0 right-0 h-0.5 bg-primary" />
                )}

                {dragOverId === page.id && dragPosition === "after" && (
                <div className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-primary" />
                )}
            <button
              type="button"
              onClick={() => toggleExpanded(page.id)}
              className="flex h-6 w-5 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={isExpanded ? "Collapse page" : "Expand page"}
            >
              {hasChildren ? (
                isExpanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )
              ) : (
                <span className="w-3" />
              )}
            </button>

            <FileText
              size={14}
              className="shrink-0 text-muted-foreground"
            />

            {isEditing ? (
              <input
                autoFocus
                value={editingTitle}
                onChange={(event) => setEditingTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    saveRename(page.id);
                  }

                  if (event.key === "Escape") {
                    cancelRenaming();
                  }
                }}
                className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={isSaving}
              />
            ) : (
              <Link
                href={`/pages/${page.id}`}
                className="min-w-0 flex-1 truncate rounded-sm py-1.5 pr-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={page.title}
              >
                {page.title || "Untitled"}
              </Link>
            )}

            {isEditing ? (
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => saveRename(page.id)}
                  disabled={isSaving}
                  className="rounded p-1 hover:bg-muted disabled:opacity-50"
                  aria-label="Save page title"
                >
                  <Check size={14} />
                </button>

                <button
                  type="button"
                  onClick={cancelRenaming}
                  disabled={isSaving}
                  className="rounded p-1 hover:bg-muted"
                  aria-label="Cancel rename"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => reorderPage(page.id, "up")}
                  disabled={index === 0 || isReordering}
                  className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                  aria-label="Move page up"
                  title="Move up"
                >
                  <ArrowUp size={13} />
                </button>

                <button
                  type="button"
                  onClick={() => reorderPage(page.id, "down")}
                  disabled={index === children.length - 1 || isReordering}
                  className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                  aria-label="Move page down"
                  title="Move down"
                >
                  <ArrowDown size={13} />
                </button>

                <button
                  type="button"
                  onClick={() => startRenaming(page)}
                  className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Rename page"
                  title="Rename"
                >
                  <Pencil size={13} />
                </button>

                <button
                  type="button"
                  onClick={() => createSubpage(page.id)}
                  disabled={creatingParent === page.id}
                  className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  aria-label="Create subpage"
                  title="Create subpage"
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
          </div>

          {hasChildren && isExpanded && (
            <div>{renderPages(page.id, depth + 1)}</div>
          )}
        </div>
      );
    });
  }

  if (loading) {
    return (
      <p className="px-2 py-2 text-sm text-muted-foreground">
        Loading pages...
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {error && (
        <p className="px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}

      {renderPages()}

      {draggingId && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => handleDrop(event)}
          className="min-h-8 rounded-md border border-dashed border-primary bg-accent p-2 text-center text-xs text-muted-foreground"
        >
          Drop here to move to top level
        </div>
      )}
    </div>
  );
}
