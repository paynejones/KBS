
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
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
  const [loading, setLoading] = useState(true);
  const [creatingParent, setCreatingParent] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadPages() {
      try {
        const response = await fetch("/api/pages");

        if (!response.ok) {
          throw new Error("Failed to load pages");
        }

        const data = await response.json();
        setPages(data);
      } catch (error) {
        console.error(error);
        setError("Unable to load pages.");
      } finally {
        setLoading(false);
      }
    }

    loadPages();
  }, []);

  const toggleExpanded = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

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

      const newPage: Page = await response.json();

      setPages((previous) => [...previous, newPage]);

      setExpanded((previous) => {
        const next = new Set(previous);
        next.add(parentId);
        return next;
      });

      router.push(`/pages/${newPage.id}`);
    } catch (error) {
      console.error(error);
      setError("Unable to create subpage.");
    } finally {
      setCreatingParent(null);
    }
  }

  const renderPages = (parentId: string | null = null, depth = 0) => {
    const children = pages.filter(
      (page) => page.parentId === parentId
    );

    return children.map((page) => {
      const hasChildren = pages.some(
        (child) => child.parentId === page.id
      );
      const isExpanded = expanded.has(page.id);

      return (
        <div key={page.id}>
          <div
            className="group flex items-center gap-1 rounded-md hover:bg-accent"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
          >
            <button
              type="button"
              onClick={() => toggleExpanded(page.id)}
              className="flex h-7 w-6 shrink-0 items-center justify-center text-muted-foreground"
              aria-label={isExpanded ? "Collapse page" : "Expand page"}
            >
              {hasChildren ? (
                isExpanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )
              ) : null}
            </button>

            <Link
              href={`/pages/${page.id}`}
              className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 text-sm"
            >
              <FileText size={14} className="shrink-0" />
              <span className="truncate">
                {page.title || "Untitled"}
              </span>
            </Link>

            <button
              type="button"
              onClick={() => createSubpage(page.id)}
              disabled={creatingParent === page.id}
              className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100 disabled:opacity-50"
              aria-label={`Create subpage under ${page.title}`}
              title="Create subpage"
            >
              <Plus size={14} />
            </button>
          </div>

          {hasChildren && isExpanded && (
            <div>{renderPages(page.id, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between px-2">
        <span className="text-xs font-medium text-muted-foreground">
          YOUR PAGES
        </span>

        <Link href="/pages" aria-label="View all pages">
          <Plus
            size={15}
            className="text-muted-foreground hover:text-foreground"
          />
        </Link>
      </div>

      {error && (
        <p className="px-2 py-1 text-xs text-destructive">{error}</p>
      )}

      {loading ? (
        <p className="px-2 text-xs text-muted-foreground">
          Loading pages...
        </p>
      ) : pages.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">
          No pages yet
        </p>
      ) : (
        <div className="space-y-0.5">{renderPages()}</div>
      )}
    </div>
  );
}
