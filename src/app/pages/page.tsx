
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Star, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { markdownFileToPage } from "@/lib/markdown-import";
import { starterPageTemplates } from "@/lib/page-templates";

type PageSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  isFavorite: boolean;
  tags: {
    id: string;
    name: string;
  }[];
};

type PageTemplate = {
  id: string;
  name: string;
  title: string;
  icon: string | null;
};

export function PagesBrowser({ favoritesOnly = false }: { favoritesOnly?: boolean }) {
  const router = useRouter();

  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [allTags, setAllTags] = useState<
    { id: string; name: string }[]
  >([]);
  const [selectedTagId, setSelectedTagId] = useState("");
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedThrough, setUpdatedThrough] = useState("");
  const [sortOrder, setSortOrder] = useState("updated-desc");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<PageTemplate[]>([]);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateMessage, setTemplateMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function fetchTags() {
      try {
        const response = await fetch("/api/tags");

        if (!response.ok) {
          throw new Error("Failed to load tags");
        }

        const data = await response.json();

        if (!cancelled) {
          setAllTags(data);
        }
      } catch (error) {
        console.error("Failed to load tags:", error);
      }
    }

    void fetchTags();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchTemplates() {
      try {
        const response = await fetch("/api/page-templates");
        if (!response.ok) throw new Error("Failed to load page templates");
        const data = await response.json();
        if (!cancelled) setTemplates(data);
      } catch (templateError) {
        if (!cancelled) {
          console.error("Failed to load page templates:", templateError);
          setTemplateMessage("Could not load page templates.");
        }
      }
    }

    void fetchTemplates();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;

    async function fetchPages() {
      setLoadError("");
      try {
        const params = new URLSearchParams();

        if (debouncedSearch) {
          params.set("q", debouncedSearch);
        }

        if (selectedTagId) {
          params.set("tagId", selectedTagId);
        }

        if (favoritesOnly) params.set("favorite", "true");

        const response = await fetch(`/api/pages?${params.toString()}`);

        if (!response.ok) {
          throw new Error("Failed to load pages");
        }

        const data = await response.json();

        if (!cancelled) {
          setPages(data);
          setLoadError("");
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load pages:", error);
          setLoadError("Failed to load pages.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchPages();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, selectedTagId, favoritesOnly, refreshKey, retryKey]);

  async function toggleFavorite(page: PageSummary) {
    const isFavorite = !page.isFavorite;
    setError("");
    try {
      const response = await fetch(`/api/pages/${page.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFavorite }),
      });
      if (!response.ok) throw new Error("Could not update favorite.");
      setPages((previous) =>
        favoritesOnly && !isFavorite
          ? previous.filter((item) => item.id !== page.id)
          : previous.map((item) =>
              item.id === page.id ? { ...item, isFavorite } : item,
            ),
      );
    } catch {
      setError("Could not update favorite. Please try again.");
    }
  }

  async function createPage() {
    setError("");

    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled" }),
      });

      if (!response.ok) {
        throw new Error("Unable to create page.");
      }

      const page = await response.json();
      router.push(`/pages/${page.id}`);
    } catch {
      setError("Could not create a page. Please try again.");
    }
  }

  async function createPageFromTemplate(templateId: string) {
    if (!templateId) return;
    setError("");
    setTemplateBusy(true);

    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });

      if (!response.ok) throw new Error("Unable to create page from template.");

      const page = await response.json();
      router.push(`/pages/${page.id}`);
    } catch {
      setError("Could not create a page from that template. Please try again.");
    } finally {
      setTemplateBusy(false);
    }
  }

  async function addStarterTemplates() {
    setTemplateBusy(true);
    setError("");
    const created: PageTemplate[] = [];

    try {
      for (const starter of starterPageTemplates()) {
        const response = await fetch("/api/page-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(starter),
        });
        if (!response.ok) throw new Error("Unable to add starter templates.");
        created.push(await response.json());
      }

      setTemplates((previous) => [...previous, ...created].sort((left, right) => left.name.localeCompare(right.name)));
      setTemplateMessage("Added starter templates.");
    } catch {
      setError("Could not add the starter templates. Please try again.");
    } finally {
      setTemplateBusy(false);
    }
  }

  async function deleteTemplate(template: PageTemplate) {
    const confirmed = window.confirm(
      `Delete the “${template.name}” template? Pages already created from it are not affected.`,
    );
    if (!confirmed) return;

    setTemplateBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/page-templates/${template.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to delete template.");
      setTemplates((previous) => previous.filter((item) => item.id !== template.id));
      setTemplateMessage(`Deleted the “${template.name}” template.`);
    } catch {
      setError("Could not delete the template. Please try again.");
    } finally {
      setTemplateBusy(false);
    }
  }

  async function importMarkdown(files: File[]) {
    if (files.length === 0) return;
    setImporting(true);
    setImportMessage("");
    setError("");
    let imported = 0;
    const failures: string[] = [];

    for (const file of files) {
      if (!/\.(md|markdown)$/i.test(file.name)) {
        failures.push(`${file.name}: unsupported file type`);
        continue;
      }
      if (file.size > 2_000_000) {
        failures.push(`${file.name}: file exceeds the 2 MB limit`);
        continue;
      }
      try {
        const importedPage = markdownFileToPage(await file.text(), file.name);
        const response = await fetch("/api/pages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(importedPage),
        });
        if (!response.ok) throw new Error("Server could not create page");
        imported++;
      } catch {
        failures.push(`${file.name}: import failed`);
      }
    }

    if (imported > 0) {
      setRefreshKey((current) => current + 1);
      window.dispatchEvent(new Event("pages-updated"));
    }
    setImportMessage(
      failures.length > 0
        ? `Imported ${imported} of ${files.length} files. ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? `; and ${failures.length - 3} more` : ""}`
        : `Imported ${imported} ${imported === 1 ? "page" : "pages"}.`,
    );
    setImporting(false);
  }

  async function deletePage(page: PageSummary) {
    const confirmed = window.confirm(
      `Move "${page.title}" and its subpages to the trash? You can restore them from the trash screen.`
    );

    if (!confirmed) return;

    setDeletingId(page.id);
    setError("");

    try {
      const response = await fetch(`/api/pages/${page.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unable to delete page.");
      }

      setPages((previous) =>
        previous.filter((item) => item.id !== page.id)
      );

      // Notify the sidebar that its page tree needs refreshing.
      window.dispatchEvent(new Event("pages-updated"));
    } catch (error) {
      console.error("Failed to delete page:", error);
      setError("Could not delete the page. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  const dateKey = (value: string) => {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const filteredPages = pages
    .filter((page) => {
      const updated = dateKey(page.updatedAt);
      return (!updatedFrom || updated >= updatedFrom) &&
        (!updatedThrough || updated <= updatedThrough);
    })
    .sort((left, right) => {
      switch (sortOrder) {
        case "updated-asc": return new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
        case "created-desc": return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        case "created-asc": return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
        case "title-asc": return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
        case "title-desc": return right.title.localeCompare(left.title, undefined, { sensitivity: "base" });
        default: return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      }
    });
  const hasFilters = Boolean(search.trim() || selectedTagId || updatedFrom || updatedThrough);

  return (
    <AppShell>
      <div className="space-y-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">
              YOUR WORKSPACE
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              {favoritesOnly ? "Favorites" : "Pages"}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {favoritesOnly
                ? "The pages you’ve saved for quick access."
                : "Browse, search, and organize your notes and documents."}
            </p>
          </div>

          {!favoritesOnly && (
            <div className="flex flex-wrap gap-2">
              <input
                ref={importInput}
                type="file"
                accept=".md,.markdown,text/markdown"
                multiple
                className="hidden"
                aria-label="Choose Markdown files to import"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void importMarkdown(files);
                }}
              />
              <Button type="button" variant="outline" onClick={() => importInput.current?.click()} disabled={importing}>
                {importing ? "Importing…" : "Import Markdown"}
              </Button>
              <select
                aria-label="Create a page from a template"
                value=""
                disabled={templateBusy || templates.length === 0}
                onChange={(event) => void createPageFromTemplate(event.target.value)}
                className="rounded-md border bg-background px-3 py-1.5 text-sm disabled:opacity-50"
              >
                <option value="">
                  {templates.length === 0 ? "No templates yet" : "New from template…"}
                </option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.icon ? `${template.icon} ${template.name}` : template.name}
                  </option>
                ))}
              </select>
              <Button onClick={() => void createPage()}>New page</Button>
            </div>
          )}
        </div>

        {!favoritesOnly && (
          <details className="group rounded-xl border bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span>
                <span className="block font-medium">Page templates</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Reusable structures for recurring notes
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {templates.length} {templates.length === 1 ? "template" : "templates"}
              </span>
            </summary>
            <div className="space-y-3 border-t p-4">
              {templates.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-center">
                  <p className="text-sm font-medium">No templates yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Add a decision journal and a project kickoff to start, or open any page and choose “Save as template”.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3"
                    disabled={templateBusy}
                    onClick={() => void addStarterTemplates()}
                  >
                    {templateBusy ? "Adding…" : "Add starter templates"}
                  </Button>
                </div>
              ) : (
                templates.map((template) => (
                  <div
                    key={template.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {template.icon ? `${template.icon} ` : ""}
                        {template.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        Creates a page titled “{template.title}”
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={templateBusy}
                        onClick={() => void createPageFromTemplate(template.id)}
                      >
                        New page
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={templateBusy}
                        aria-label={`Delete the ${template.name} template`}
                        onClick={() => void deleteTemplate(template)}
                      >
                        <Trash2 size={16} className="text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
              {templateMessage && (
                <p role="status" className="text-xs text-muted-foreground">
                  {templateMessage}
                </p>
              )}
            </div>
          </details>
        )}

        <div className="relative">
          <input
            type="search"
            placeholder="Search pages..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 pl-9 text-sm outline-none focus:ring-2 focus:ring-ring"
          />

          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </span>
        </div>

        <div className="grid grid-cols-1 items-end gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 lg:flex lg:flex-wrap">
          <select
            aria-label="Filter pages by tag"
            value={selectedTagId}
            onChange={(event) => setSelectedTagId(event.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm sm:col-span-2 lg:w-auto lg:min-w-40"
          >
            <option value="">All tags</option>

            {allTags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>

          <label className="grid gap-1 text-xs text-muted-foreground">
            Updated from
            <input type="date" value={updatedFrom} max={updatedThrough || undefined} onChange={(event) => setUpdatedFrom(event.target.value)} className="w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Updated through
            <input type="date" value={updatedThrough} min={updatedFrom || undefined} onChange={(event) => setUpdatedThrough(event.target.value)} className="w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Sort
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground lg:w-auto">
              <option value="updated-desc">Recently updated</option>
              <option value="updated-asc">Least recently updated</option>
              <option value="created-desc">Recently created</option>
              <option value="created-asc">Oldest created</option>
              <option value="title-asc">Title A–Z</option>
              <option value="title-desc">Title Z–A</option>
            </select>
          </label>
          {hasFilters && <Button type="button" variant="ghost" size="sm" onClick={() => { setSearch(""); setSelectedTagId(""); setUpdatedFrom(""); setUpdatedThrough(""); setSortOrder("updated-desc"); }}>Clear filters</Button>}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {importMessage && <p role="status" className="text-sm text-muted-foreground">{importMessage}</p>}

        {!loading && !loadError && (
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            Showing {filteredPages.length} {favoritesOnly ? "favorite" : "page"}{filteredPages.length === 1 ? "" : "s"}
          </p>
        )}

        {loading ? (
          <div role="status" aria-label="Loading pages" className="grid animate-pulse gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="grid gap-2 rounded-xl border bg-card p-4">
                <span className="h-4 w-2/5 rounded bg-muted" />
                <span className="h-3 w-1/4 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => { setLoading(true); setRetryKey((current) => current + 1); }}>Try again</Button>
          </div>
        ) : filteredPages.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center">
            <p className="font-medium">
              {hasFilters ? "No matching pages" : "No pages yet"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {hasFilters
                ? "Try changing or clearing your filters."
                : "Create your first note to get started."}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredPages.map((page) => (
              <div
                key={page.id}
                className="flex min-w-0 items-start gap-2 rounded-xl border bg-card p-4 transition-colors hover:border-primary/25 hover:bg-accent/20 sm:p-5"
              >
                <Link
                  href={`/pages/${page.id}`}
                  className="min-w-0 flex-1"
                >
                  <span className="block truncate font-medium tracking-tight">
                    {page.title || "Untitled"}
                  </span>

                  <span className="mt-2 block text-xs text-muted-foreground">
                    Updated {new Date(page.updatedAt).toLocaleDateString()}
                  </span>

                  {page.tags.length > 0 && (
                    <span className="mt-2 flex flex-wrap gap-2">
                      {page.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </span>
                  )}
                </Link>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void toggleFavorite(page)}
                  aria-label={page.isFavorite ? `Remove ${page.title} from favorites` : `Add ${page.title} to favorites`}
                  title={page.isFavorite ? "Remove from favorites" : "Add to favorites"}
                >
                  <Star size={16} className={page.isFavorite ? "fill-current text-amber-500" : "text-muted-foreground"} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={deletingId !== null}
                  onClick={() => void deletePage(page)}
                  aria-label={`Delete ${page.title}`}
                  title="Delete page"
                >
                  {deletingId === page.id ? (
                    <span className="text-xs">...</span>
                  ) : (
                    <Trash2 size={16} className="text-muted-foreground hover:text-destructive" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function PagesPage() {
  return <PagesBrowser />;
}
