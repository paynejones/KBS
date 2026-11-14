
"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, FolderUp, Link2Off, SlidersHorizontal, Star, Trash2, Upload } from "lucide-react";
import { AppShell } from "@/components/app-shell";
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
import { Button } from "@/components/ui/button";
import {
  describeMarkdownImport,
  importMarkdownFiles,
  importMarkdownFolder,
} from "@/lib/markdown-import-files";
import { starterPageTemplates } from "@/lib/page-templates";
import { revealTemplateFromHash } from "@/lib/page-template-deep-link";
import {
  LISTING_DEFAULT_SORT,
  LISTING_PAGE_SIZE,
  listingSearch,
  readListingSearch,
  type ListingWindow,
} from "@/lib/listing-link";
import {
  getNavigationSnapshot,
  getServerNavigationSnapshot,
  subscribeToNavigation,
} from "@/lib/navigation";

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



/** The address never changes behind this component's back, so it needs no
 * listeners; React still re-reads it after hydration. */
const subscribeToAddress = () => () => {};

/** The first and last moment of a local calendar day, as ISO instants. */
function dayStart(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toISOString();
}

function dayEnd(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

export function PagesBrowser({ favoritesOnly = false }: { favoritesOnly?: boolean }) {
  const router = useRouter();
  const showDatabasePages = useSyncExternalStore(
    subscribeToNavigation,
    getNavigationSnapshot,
    getServerNavigationSnapshot,
  ).showDatabasePages;

  const [pages, setPages] = useState<PageSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [allTags, setAllTags] = useState<
    { id: string; name: string }[]
  >([]);
  // The address is an external store: the server has none, the browser has the
  // real one, so the first client render matches the server and the listing
  // adopts the URL on the render right after.
  const hydrated = useSyncExternalStore(subscribeToAddress, () => true, () => false);
  const addressSearch = useSyncExternalStore(
    subscribeToAddress,
    () => window.location.search,
    () => "",
  );
  const addressListing = readListingSearch(addressSearch);

  // Until the reader touches a control, the address decides the listing: its
  // page, sort, search term, tag and date bounds all come from there.
  const [selection, setSelection] = useState<ListingWindow | null>(null);
  const page = selection?.page ?? addressListing.page;
  const offset = (page - 1) * LISTING_PAGE_SIZE;
  const sortOrder = selection?.sort ?? addressListing.sort ?? LISTING_DEFAULT_SORT;
  const appliedQuery = selection?.query ?? addressListing.query ?? "";
  const selectedTagId = selection?.tagId ?? addressListing.tagId ?? "";
  const updatedFrom = selection?.from ?? addressListing.from ?? "";
  const updatedThrough = selection?.through ?? addressListing.through ?? "";

  // Typed text stays local until the pause ends; the listing (and the address)
  // follow the applied query.
  const [typedSearch, setTypedSearch] = useState<string | null>(null);
  const search = typedSearch ?? appliedQuery;

  const updateSelection = useCallback(
    (patch: Partial<ListingWindow>) => {
      setSelection((current) => ({
        page: current?.page ?? addressListing.page,
        sort: current?.sort ?? addressListing.sort ?? LISTING_DEFAULT_SORT,
        query: current?.query ?? addressListing.query ?? "",
        tagId: current?.tagId ?? addressListing.tagId ?? "",
        from: current?.from ?? addressListing.from ?? "",
        through: current?.through ?? addressListing.through ?? "",
        ...patch,
      }));
    },
    [
      addressListing.page,
      addressListing.sort,
      addressListing.query,
      addressListing.tagId,
      addressListing.from,
      addressListing.through,
    ],
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const templatesDetailsRef = useRef<HTMLDetailsElement>(null);
  const [templates, setTemplates] = useState<PageTemplate[]>([]);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateMessage, setTemplateMessage] = useState("");
  const [pendingPageDelete, setPendingPageDelete] = useState<PageSummary | null>(null);
  const [pendingTemplateDelete, setPendingTemplateDelete] = useState<PageTemplate | null>(null);

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
    if (!templates.length) return;
    const frame = window.requestAnimationFrame(() => {
      revealTemplateFromHash(
        window.location.hash,
        (templateId) => document.getElementById(`template-${templateId}`),
        templatesDetailsRef.current,
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [templates]);

  useEffect(() => {
    // Nothing to apply while the box still matches the listing it came from.
    if (search.trim() === appliedQuery) return;
    const timer = setTimeout(() => {
      updateSelection({ query: search.trim(), page: 1 });
    }, 300);

    return () => clearTimeout(timer);
  }, [search, appliedQuery, updateSelection]);

  // The listing writes its own position and filters into the address; the
  // defaults stay out of it so a plain listing keeps its clean address.
  useEffect(() => {
    if (!hydrated) return;
    const next = `${window.location.pathname}${listingSearch(window.location.search, {
      page,
      sort: sortOrder,
      query: appliedQuery,
      tagId: selectedTagId,
      from: updatedFrom,
      through: updatedThrough,
    })}`;
    const current = `${window.location.pathname}${window.location.search}`;
    // Replacing rather than pushing: the listing's own position is not a place
    // the reader should have to walk back through.
    if (next !== current) window.history.replaceState(null, "", next);
  }, [hydrated, page, sortOrder, appliedQuery, selectedTagId, updatedFrom, updatedThrough]);

  useEffect(() => {
    // Nothing is asked for until the address has been read, so a restored page
    // is fetched once rather than after an extra default request.
    if (!hydrated) return;
    let cancelled = false;

    async function fetchPages() {
      setLoadError("");
      try {
        const params = new URLSearchParams();

        if (appliedQuery) {
          params.set("q", appliedQuery);
        }

        if (selectedTagId) {
          params.set("tagId", selectedTagId);
        }

        if (favoritesOnly) params.set("favorite", "true");

        if (showDatabasePages) params.set("includeRecordPages", "true");

        // One screenful arrives already ordered and date-filtered, so the
        // browser never holds every matching page to sort it itself.
        params.set("sort", sortOrder);
        params.set("limit", String(LISTING_PAGE_SIZE));
        params.set("offset", String(offset));
        if (updatedFrom) params.set("updatedFrom", dayStart(updatedFrom));
        if (updatedThrough) params.set("updatedThrough", dayEnd(updatedThrough));

        const response = await fetch(`/api/pages?${params.toString()}`);

        if (!response.ok) {
          throw new Error("Failed to load pages");
        }

        const data = (await response.json()) as { pages: PageSummary[]; total: number };

        if (!cancelled) {
          setPages(data.pages);
          setTotal(data.total);
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
  }, [
    appliedQuery,
    selectedTagId,
    favoritesOnly,
    refreshKey,
    retryKey,
    showDatabasePages,
    sortOrder,
    updatedFrom,
    updatedThrough,
    offset,
    hydrated,
  ]);

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
      if (favoritesOnly && !isFavorite) setTotal((current) => Math.max(0, current - 1));
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
    const { imported, failures } = await importMarkdownFiles(files);

    if (imported > 0) {
      setRefreshKey((current) => current + 1);
      window.dispatchEvent(new Event("pages-updated"));
    }
    setImportMessage(describeMarkdownImport(imported, files.length, failures));
    setImporting(false);
  }

  async function importMarkdownFolderFiles(files: File[]) {
    if (files.length === 0) return;
    setImporting(true);
    setImportMessage("");
    setError("");

    const { imported, failures } = await importMarkdownFolder(files);

    if (imported > 0) {
      setRefreshKey((current) => current + 1);
      window.dispatchEvent(new Event("pages-updated"));
    }
    setImportMessage(describeMarkdownImport(imported, files.length, failures));
    setImporting(false);
  }

  async function deletePage(target: PageSummary) {
    setDeletingId(target.id);
    setError("");

    try {
      const response = await fetch(`/api/pages/${target.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unable to delete page.");
      }

      setPages((previous) =>
        previous.filter((item) => item.id !== target.id)
      );
      setTotal((current) => Math.max(0, current - 1));
      // Removing the only row on a later page leaves the window past the end.
      if (pages.length === 1 && page > 1) updateSelection({ page: page - 1 });

      // Notify the sidebar that its page tree needs refreshing.
      window.dispatchEvent(new Event("pages-updated"));
    } catch (error) {
      console.error("Failed to delete page:", error);
      setError("Could not delete the page. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  const hasFilters = Boolean(
    search.trim() || selectedTagId || updatedFrom || updatedThrough,
  );
  const isFiltered = Boolean(
    appliedQuery || selectedTagId || updatedFrom || updatedThrough,
  );
  const activeFilterCount = [selectedTagId, updatedFrom, updatedThrough].filter(
    Boolean,
  ).length;

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
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={importInput}
                type="file"
                accept=".md,.markdown,text/markdown,image/*,.pdf,.txt,.csv,.json,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.epub,.rtf"
                multiple
                className="hidden"
                aria-label="Choose Markdown files to import"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void importMarkdown(files);
                }}
              />
              <input
                ref={folderInput}
                type="file"
                multiple
                {...{ webkitdirectory: "", directory: "" }}
                className="hidden"
                aria-label="Choose a folder of Markdown files to import"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void importMarkdownFolderFiles(files);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => importInput.current?.click()}
                disabled={importing}
                aria-label={importing ? "Importing Markdown" : "Import Markdown"}
                title="Import Markdown files as pages"
              >
                <Upload size={15} /> {importing ? "Importing…" : "Import Markdown"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => folderInput.current?.click()}
                disabled={importing}
                aria-label={importing ? "Importing Markdown folder" : "Import Markdown folder"}
                title="Import a folder of Markdown files as nested pages"
              >
                <FolderUp size={15} /> Import folder
              </Button>
              <Button onClick={() => void createPage()}>New page</Button>
              <Link
                href="/orphans"
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Link2Off size={15} aria-hidden="true" />
                Unconnected
              </Link>
            </div>
          )}
        </div>

        {!favoritesOnly && (
          <details ref={templatesDetailsRef} className="group rounded-xl border bg-card">
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
                    id={`template-${template.id}`}
                    className="flex scroll-mt-24 flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
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
                        onClick={() => setPendingTemplateDelete(template)}
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

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
          <input
            type="search"
            placeholder="Search pages..."
            value={search}
            onChange={(event) => setTypedSearch(event.target.value)}
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

          <details className="group relative shrink-0">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
              <SlidersHorizontal size={15} aria-hidden="true" />
              Filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown size={14} aria-hidden="true" className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-2 grid gap-3 rounded-lg border bg-card p-3 sm:absolute sm:right-0 sm:z-20 sm:mt-1 sm:w-80 sm:shadow-lg">
              <label className="grid gap-1 text-xs text-muted-foreground">
                Tag
                <select
                  aria-label="Filter pages by tag"
                  value={selectedTagId}
                  onChange={(event) => updateSelection({ tagId: event.target.value, page: 1 })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">All tags</option>
                  {allTags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Updated from
                  <input type="date" value={updatedFrom} max={updatedThrough || undefined} onChange={(event) => updateSelection({ from: event.target.value, page: 1 })} className="w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground" />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Updated through
                  <input type="date" value={updatedThrough} min={updatedFrom || undefined} onChange={(event) => updateSelection({ through: event.target.value, page: 1 })} className="w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground" />
                </label>
              </div>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Sort
                <select value={sortOrder} onChange={(event) => updateSelection({ sort: event.target.value, page: 1 })} className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground">
                  <option value="updated-desc">Recently updated</option>
                  <option value="updated-asc">Least recently updated</option>
                  <option value="created-desc">Recently created</option>
                  <option value="created-asc">Oldest created</option>
                  <option value="title-asc">Title A–Z</option>
                  <option value="title-desc">Title Z–A</option>
                </select>
              </label>
              {isFiltered && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTypedSearch("");
                    updateSelection({
                      query: "",
                      tagId: "",
                      from: "",
                      through: "",
                      sort: LISTING_DEFAULT_SORT,
                      page: 1,
                    });
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </details>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {importMessage && <p role="status" className="text-sm text-muted-foreground">{importMessage}</p>}

        {!loading && !loadError && total > 0 && (
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            Showing {offset + 1}–{offset + pages.length} of {total} {favoritesOnly ? "favorite" : "page"}{total === 1 ? "" : "s"}
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
        ) : pages.length === 0 ? (
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
          <>
          <div className="grid gap-3 sm:grid-cols-2">
            {pages.map((page) => (
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
                  onClick={() => setPendingPageDelete(page)}
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

          {(offset > 0 || offset + pages.length < total) && (
            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => updateSelection({ page: page - 1 })}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={offset + pages.length >= total}
                onClick={() => updateSelection({ page: page + 1 })}
              >
                Next
              </Button>
            </div>
          )}
          </>
        )}
      </div>

      <AlertDialog open={Boolean(pendingPageDelete)} onOpenChange={(open) => { if (!open) setPendingPageDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move “{pendingPageDelete?.title || "Untitled"}” to the trash?</AlertDialogTitle>
            <AlertDialogDescription>
              Its subpages move too. You can restore them from the trash screen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingId !== null}
              onClick={() => {
                const pending = pendingPageDelete;
                setPendingPageDelete(null);
                if (pending) void deletePage(pending);
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(pendingTemplateDelete)} onOpenChange={(open) => { if (!open) setPendingTemplateDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingTemplateDelete?.name ?? "template"}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Pages already created from this template are not affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={templateBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={templateBusy}
              onClick={() => {
                const pending = pendingTemplateDelete;
                setPendingTemplateDelete(null);
                if (pending) void deleteTemplate(pending);
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Delete template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

export default function PagesPage() {
  return <PagesBrowser />;
}
