"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  BookMarked,
  BookOpen,
  Clock,
  Database,
  FileText,
  FolderUp,
  GitFork,
  House,
  Inbox,
  LayoutTemplate,
  Plus,
  Search,
  Star,
  Target,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { formatRecentTime, loadRecentPages, type RecentPage } from "@/lib/recents";
import {
  describeMarkdownImport,
  importMarkdownFiles,
  importMarkdownFolder,
} from "@/lib/markdown-import-files";

type PageOption = { id: string; title: string; isFavorite: boolean; isRecordPage?: boolean };
type DatabaseOption = { id: string; name: string };
type PageTemplateOption = { id: string; name: string; title: string; icon: string | null };
type SearchRecord = { id: string; title: string; databaseId: string; databaseName: string };
type SearchResults = {
  pages: { id: string; title: string; updatedAt: string }[];
  records: SearchRecord[];
};

type PaletteItem = {
  key: string;
  label: string;
  detail?: string;
  group: string;
  icon: ReactNode;
  run: () => void;
};

const emptyResults: SearchResults = { pages: [], records: [] };

export function CommandPalette({ showTrigger = true }: { showTrigger?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pages, setPages] = useState<PageOption[]>([]);
  const [recordPageIds, setRecordPageIds] = useState<Set<string>>(new Set());
  const [databases, setDatabases] = useState<DatabaseOption[]>([]);
  const [templates, setTemplates] = useState<PageTemplateOption[]>([]);
  const [recents, setRecents] = useState<RecentPage[]>([]);
  const [results, setResults] = useState<SearchResults>(emptyResults);
  const [resultsQuery, setResultsQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [shortcutsLoaded, setShortcutsLoaded] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [currentPageId, setCurrentPageId] = useState<string | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    setError("");
    setNotice("");
    setSearching(false);
  }, []);

  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery("");
    setActiveIndex(0);
    setError("");
    setNotice("");
    setSearching(false);
    setRecents(loadRecentPages());
    // Read the URL when the palette opens rather than with usePathname(),
    // which would block prerendering of every page that renders the shell.
    const match = /^\/pages\/([0-9a-fA-F-]{36})$/.exec(window.location.pathname);
    setCurrentPageId(match?.[1] ?? null);
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    window.addEventListener("open-global-search", openPalette);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener("open-global-search", openPalette);
    };
  }, [openPalette]);

  // Page titles and favorites come from the graph endpoint so opening the
  // palette never downloads full page content.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function loadShortcuts() {
      try {
        // Templates are a convenience here: a failed request must not take
        // page and database navigation down with it.
        const [graphResponse, databasesResponse, templatesResponse] = await Promise.all([
          fetch("/api/graph"),
          fetch("/api/databases"),
          fetch("/api/page-templates").catch(() => null),
        ]);
        if (!graphResponse.ok || !databasesResponse.ok) {
          throw new Error("Could not load workspace shortcuts.");
        }
        const graphData: { nodes: PageOption[] } = await graphResponse.json();
        const databaseData: DatabaseOption[] = await databasesResponse.json();
        const templateData: PageTemplateOption[] =
          templatesResponse?.ok ? await templatesResponse.json() : [];
        if (cancelled) return;
        const hiddenPageIds = new Set(
          graphData.nodes.filter((page) => page.isRecordPage).map((page) => page.id),
        );
        setRecordPageIds(hiddenPageIds);
        setPages(graphData.nodes.filter((page) => !page.isRecordPage));
        setDatabases(databaseData);
        setTemplates(templateData);
        setError("");
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load workspace shortcuts.",
          );
        }
      } finally {
        if (!cancelled) setShortcutsLoaded(true);
      }
    }

    void loadShortcuts();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const searchTerm = query.trim().toLocaleLowerCase();
    if (searchTerm.length < 2) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(searchTerm)}`);
        if (!response.ok) throw new Error("Search is unavailable right now.");
        const data: SearchResults = await response.json();
        if (cancelled) return;
        setResults(data);
        setResultsQuery(searchTerm);
      } catch (searchError) {
        if (cancelled) return;
        setResults(emptyResults);
        setResultsQuery(searchTerm);
        setError(
          searchError instanceof Error ? searchError.message : "Search is unavailable right now.",
        );
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  async function createPage(title = "Untitled") {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error("Could not create a page.");
      const page: { id: string } = await response.json();
      go(`/pages/${page.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create a page.");
    } finally {
      setCreating(false);
    }
  }

  async function createPageFromTemplate(templateId: string) {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      if (!response.ok) throw new Error("Could not create a page from that template.");
      const page: { id: string } = await response.json();
      go(`/pages/${page.id}`);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create a page from that template.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function saveCurrentPageAsTemplate(pageId: string, suggestedName: string) {
    if (creating) return;
    const name = window.prompt("Name this template", suggestedName || "Template");
    if (!name?.trim()) return;

    setCreating(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/page-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), pageId }),
      });
      if (!response.ok) throw new Error("Could not save the template.");
      const template: PageTemplateOption = await response.json();
      // Show the new template in this palette session without reloading it.
      setTemplates((previous) =>
        [...previous, template].sort((left, right) => left.name.localeCompare(right.name)),
      );
      setNotice(`Saved “${template.name}” as a template.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the template.");
    } finally {
      setCreating(false);
    }
  }

  async function createDatabase() {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled database" }),
      });
      if (!response.ok) throw new Error("Could not create a database.");
      const database: { id: string } = await response.json();
      go(`/databases/${database.id}`);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Could not create a database.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function importMarkdownFromPalette(files: File[], folder = false) {
    if (files.length === 0) return;
    setError("");
    setNotice("");
    const { imported, failures } = folder ? await importMarkdownFolder(files) : await importMarkdownFiles(files);
    if (imported > 0) window.dispatchEvent(new Event("pages-updated"));
    if (imported === 0) {
      setError(failures.length > 0 ? describeMarkdownImport(0, files.length, failures) : "No Markdown files were imported.");
      return;
    }
    if (failures.length > 0) {
      // Stay open so the failed files stay readable; the imported pages are
      // already saved and appear once the palette closes.
      setNotice(describeMarkdownImport(imported, files.length, failures));
      return;
    }
    go("/pages");
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const activeResults = resultsQuery === normalizedQuery ? results : emptyResults;
  const isSearching = searching && normalizedQuery.length >= 2;
  const typedTitle = query.trim();

  function matches(text: string) {
    return !normalizedQuery || text.toLocaleLowerCase().includes(normalizedQuery);
  }

  const pageById = new Map(pages.map((page) => [page.id, page]));
  const currentPage = currentPageId ? pageById.get(currentPageId) : undefined;
  const visibleRecents = recents.filter((entry) => !recordPageIds.has(entry.id));
  const recentIds = new Set(visibleRecents.map((entry) => entry.id));
  const favoritePages = pages.filter(
    (page) => page.isFavorite && !recentIds.has(page.id),
  );
  const favoriteIds = new Set(favoritePages.map((page) => page.id));

  const actions: PaletteItem[] = [
    {
      key: "action-new-page",
      label: "New page",
      group: "Actions",
      icon: <Plus size={16} />,
      run: () => void createPage(),
    },
    {
      key: "action-new-database",
      label: "New database",
      detail: "Table, board, or gallery",
      group: "Actions",
      icon: <Database size={16} />,
      run: () => void createDatabase(),
    },
    {
      key: "action-import-markdown",
      label: "Import Markdown",
      detail: "Turn .md files into pages",
      group: "Actions",
      icon: <Upload size={16} />,
      run: () => document.getElementById("command-palette-markdown-import")?.click(),
    },
    {
      key: "action-import-markdown-folder",
      label: "Import Markdown folder",
      detail: "Keep folders as nested pages",
      group: "Actions",
      icon: <FolderUp size={16} />,
      run: () => document.getElementById("command-palette-markdown-folder")?.click(),
    },
    {
      key: "nav-home",
      label: "Go to home",
      group: "Actions",
      icon: <House size={16} />,
      run: () => go("/"),
    },
    {
      key: "nav-pages",
      label: "Go to all pages",
      group: "Actions",
      icon: <FileText size={16} />,
      run: () => go("/pages"),
    },
    {
      key: "nav-searches",
      label: "Go to saved searches",
      detail: "Live page collections",
      group: "Actions",
      icon: <BookMarked size={16} />,
      run: () => go("/searches"),
    },
    {
      key: "nav-reading",
      label: "Go to reading list",
      detail: "Articles, books, and highlights",
      group: "Actions",
      icon: <BookOpen size={16} />,
      run: () => go("/reading"),
    },
    {
      key: "nav-focus",
      label: "Go to focus view",
      detail: "A project, its tasks, and references",
      group: "Actions",
      icon: <Target size={16} />,
      run: () => go("/focus"),
    },
    {
      key: "nav-inbox",
      label: "Go to inbox",
      group: "Actions",
      icon: <Inbox size={16} />,
      run: () => go("/inbox"),
    },
    {
      key: "nav-databases",
      label: "Go to databases",
      group: "Actions",
      icon: <Database size={16} />,
      run: () => go("/databases"),
    },
    {
      key: "nav-favorites",
      label: "Go to favorites",
      group: "Actions",
      icon: <Star size={16} />,
      run: () => go("/favorites"),
    },
    {
      key: "nav-graph",
      label: "Open page graph",
      group: "Actions",
      icon: <GitFork size={16} />,
      run: () => go("/graph"),
    },
    {
      key: "nav-trash",
      label: "Go to trash",
      detail: "Restore or delete pages",
      group: "Actions",
      icon: <Trash2 size={16} />,
      run: () => go("/trash"),
    },
  ];

  if (currentPageId) {
    actions.splice(2, 0, {
      key: "action-save-page-template",
      label: "Save current page as template",
      detail: currentPage?.title || "Current page",
      group: "Actions",
      icon: <LayoutTemplate size={16} />,
      run: () => void saveCurrentPageAsTemplate(currentPageId, currentPage?.title ?? ""),
    });
  }

  if (typedTitle) {
    actions.unshift({
      key: "action-create-query",
      label: `Create page “${typedTitle}”`,
      detail: "Use the typed title",
      group: "Actions",
      icon: <Plus size={16} />,
      run: () => void createPage(typedTitle),
    });
  }

  const templateItems: PaletteItem[] = templates.map((template) => ({
    key: `template-${template.id}`,
    label: `New page from “${template.name}”`,
    detail: template.icon ? `${template.icon} Template` : "Template",
    group: "Templates",
    icon: <LayoutTemplate size={16} />,
    run: () => void createPageFromTemplate(template.id),
  }));

  const recentItems: PaletteItem[] = visibleRecents.map((entry) => ({
    key: `recent-${entry.id}`,
    label: pageById.get(entry.id)?.title || entry.title || "Untitled",
    detail: formatRecentTime(entry.visitedAt),
    group: "Recent",
    icon: <Clock size={16} />,
    run: () => go(`/pages/${entry.id}`),
  }));

  const favoriteItems: PaletteItem[] = favoritePages.slice(0, 6).map((page) => ({
    key: `favorite-${page.id}`,
    label: page.title || "Untitled",
    detail: "Favorite page",
    group: "Favorites",
    icon: <Star size={16} />,
    run: () => go(`/pages/${page.id}`),
  }));

  const pageItems: PaletteItem[] = pages
    .filter((page) => !recentIds.has(page.id) && !favoriteIds.has(page.id))
    .filter((page) => matches(page.title || "Untitled"))
    .slice(0, 6)
    .map((page) => ({
      key: `page-${page.id}`,
      label: page.title || "Untitled",
      detail: "Page",
      group: "Pages",
      icon: <FileText size={16} />,
      run: () => go(`/pages/${page.id}`),
    }));

  const databaseItems: PaletteItem[] = databases
    .filter((database) => matches(database.name))
    .slice(0, 6)
    .map((database) => ({
      key: `database-${database.id}`,
      label: database.name || "Untitled database",
      detail: "Database",
      group: "Databases",
      icon: <Database size={16} />,
      run: () => go(`/databases/${database.id}`),
    }));

  const searchItems: PaletteItem[] = [];
  if (normalizedQuery.length >= 2) {
    const alreadyShown = new Set<string>(recentIds);
    for (const page of pages) {
      if (page.isFavorite || page.title.toLocaleLowerCase().includes(normalizedQuery)) {
        alreadyShown.add(page.id);
      }
    }
    for (const page of activeResults.pages) {
      if (alreadyShown.has(page.id) || recordPageIds.has(page.id)) continue;
      searchItems.push({
        key: `search-page-${page.id}`,
        label: page.title || "Untitled",
        detail: `Page · ${new Date(page.updatedAt).toLocaleDateString()}`,
        group: "Search results",
        icon: <FileText size={16} />,
        run: () => go(`/pages/${page.id}`),
      });
    }
    for (const record of activeResults.records) {
      searchItems.push({
        key: `search-record-${record.id}`,
        label: record.title || "Untitled",
        detail: `Record · ${record.databaseName}`,
        group: "Search results",
        icon: <Database size={16} />,
        run: () => go(`/databases/${record.databaseId}/records/${record.id}`),
      });
    }
  }

  const visibleItems = [
    ...actions,
    ...templateItems,
    ...recentItems,
    ...favoriteItems,
    ...pageItems,
    ...databaseItems,
    ...searchItems,
  ].filter((item) => matches(`${item.label} ${item.detail ?? ""}`));

  const safeIndex = visibleItems.length === 0
    ? 0
    : Math.min(activeIndex, visibleItems.length - 1);
  const isLoadingShortcuts = open && !shortcutsLoaded;

  useEffect(() => {
    if (!open) return;
    itemRefs.current[safeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, safeIndex]);

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (visibleItems.length) {
        setActiveIndex((safeIndex + 1) % visibleItems.length);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (visibleItems.length) {
        setActiveIndex((safeIndex - 1 + visibleItems.length) % visibleItems.length);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      visibleItems[safeIndex]?.run();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  return (
    <>
      {showTrigger && (
        <button
          type="button"
          onClick={openPalette}
          aria-keyshortcuts="Control+K Meta+K"
          aria-label="Open command palette to search, jump, or create"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search size={16} />
          <span className="hidden sm:inline">Search or jump to…</span>
          <kbd className="ml-2 hidden rounded border px-1.5 py-0.5 text-[10px] sm:inline">Ctrl K</kbd>
        </button>
      )}

      <input
        id="command-palette-markdown-import"
        type="file"
        accept=".md,.markdown,text/markdown,image/*,.pdf,.txt,.csv,.json,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.epub,.rtf"
        multiple
        className="hidden"
        aria-label="Choose Markdown files to import"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void importMarkdownFromPalette(files);
        }}
      />
      <input
        id="command-palette-markdown-folder"
        type="file"
        multiple
        {...{ webkitdirectory: "", directory: "" }}
        className="hidden"
        aria-label="Choose a folder of Markdown files to import"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void importMarkdownFromPalette(files, true);
        }}
      />

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="flex w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b px-4">
              <Search size={18} className="shrink-0 text-muted-foreground" />
              <input
                autoFocus
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-palette-list"
                aria-autocomplete="list"
                aria-activedescendant={
                  visibleItems[safeIndex]
                    ? `command-item-${visibleItems[safeIndex].key}`
                    : undefined
                }
                aria-label="Search or run a command"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                  setError("");
                  setNotice("");
                }}
                onKeyDown={handleInputKeyDown}
                placeholder="Search pages, databases, or type a command"
                className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={close}
                aria-label="Close command palette"
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X size={17} />
              </button>
            </div>

            <div
              id="command-palette-list"
              role="listbox"
              aria-label="Commands and results"
              className="max-h-[60vh] overflow-y-auto p-2"
            >
              {error && (
                <p role="alert" className="px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
                  {notice}
                </p>
              )}
              {isSearching && (
                <p role="status" className="px-3 py-1 text-xs text-muted-foreground">
                  Searching…
                </p>
              )}
              {isLoadingShortcuts && (
                <p role="status" className="px-3 py-1 text-xs text-muted-foreground">
                  Loading shortcuts…
                </p>
              )}
              {!isLoadingShortcuts && visibleItems.length === 0 && !isSearching && (
                <p className="px-3 py-6 text-sm text-muted-foreground">
                  No matching pages, records, or commands.
                </p>
              )}

              {visibleItems.map((item, index) => {
                const showGroup = index === 0 || visibleItems[index - 1].group !== item.group;
                return (
                  <div key={item.key}>
                    {showGroup && (
                      <h2 className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        {item.group}
                      </h2>
                    )}
                    <button
                      type="button"
                      id={`command-item-${item.key}`}
                      role="option"
                      aria-selected={index === safeIndex}
                      ref={(node) => {
                        itemRefs.current[index] = node;
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => item.run()}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                        index === safeIndex
                          ? "bg-brand-soft text-brand-foreground"
                          : "hover:bg-accent"
                      }`}
                    >
                      <span
                        className={`shrink-0 ${
                          index === safeIndex ? "text-brand" : "text-muted-foreground"
                        }`}
                      >
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {item.label}
                      </span>
                      {item.detail && (
                        <span className="max-w-52 shrink-0 truncate text-xs text-muted-foreground">
                          {item.detail}
                        </span>
                      )}
                      {index === safeIndex && (
                        <span className="shrink-0 rounded border border-brand/30 px-1 text-[10px] text-brand-foreground">
                          ↵
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-3">
                <span>↑↓ navigate</span>
                <span>↵ open</span>
                <span>esc close</span>
              </span>
              <span>KBS search</span>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
