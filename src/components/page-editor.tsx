
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Star } from "lucide-react";
import Image from "next/image";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DatabaseEmbedExtension, DatabaseEmbedPicker } from "@/components/database-embed";
import { CalloutExtension, TaskItemExtension, TaskListExtension, ToggleExtension } from "@/components/task-list-extension";
import { TableCellExtension, TableExtension, TableHeaderExtension, TableRowExtension } from "@/components/table-extension";
import { ImageExtension } from "@/components/image-extension";
import { Button } from "@/components/ui/button";
import { EditorToolbar } from "@/components/editor-toolbar";
import { PageTags } from "@/components/page-tags";
import { PageLinks } from "@/components/page-links";
import { tiptapToMarkdown } from "@/lib/markdown";
import { readRecoverablePageDraft } from "@/lib/page-draft";

type PageData = {
  id: string;
  title: string;
  content: string;
  contentJson: Record<string, unknown>;
  parentId: string | null;
  isFavorite: boolean;
  icon: string | null;
  coverImageUrl: string | null;
  updatedAt: string;
};

type SaveStatus = "loading" | "saved" | "saving" | "error";

type SlashCommand = {
  label: string;
  detail: string;
  keywords: string;
  run: (editor: NonNullable<ReturnType<typeof useEditor>>) => void;
};

const slashCommands: SlashCommand[] = [
  { label: "Text", detail: "Plain paragraph", keywords: "paragraph text", run: (editor) => editor.chain().focus().setParagraph().run() },
  { label: "Heading 1", detail: "Large section heading", keywords: "h1 title", run: (editor) => editor.chain().focus().setHeading({ level: 1 }).run() },
  { label: "Heading 2", detail: "Medium section heading", keywords: "h2 subtitle", run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run() },
  { label: "Bullet list", detail: "Unordered list", keywords: "ul bullets", run: (editor) => editor.chain().focus().toggleBulletList().run() },
  { label: "Numbered list", detail: "Ordered list", keywords: "ol ordered", run: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { label: "Blockquote", detail: "Indented quote", keywords: "quote", run: (editor) => editor.chain().focus().toggleBlockquote().run() },
  { label: "Code block", detail: "Monospaced code", keywords: "code", run: (editor) => editor.chain().focus().toggleCodeBlock().run() },
  { label: "Divider", detail: "Horizontal separator", keywords: "rule line", run: (editor) => editor.chain().focus().setHorizontalRule().run() },
  { label: "Task list", detail: "Checkbox list", keywords: "todo checklist", run: (editor) => editor.chain().focus().insertContent({ type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }] }).run() },
  { label: "Callout", detail: "Highlighted note", keywords: "note info warning", run: (editor) => editor.chain().focus().insertContent({ type: "callout", content: [{ type: "paragraph" }] }).run() },
  { label: "Toggle", detail: "Collapsible content", keywords: "details collapse disclosure", run: (editor) => editor.chain().focus().insertContent({ type: "toggleBlock", content: [{ type: "paragraph" }] }).run() },
  { label: "Table", detail: "3 rows × 2 columns", keywords: "grid cells", run: (editor) => editor.chain().focus().insertContent({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph" }] }, { type: "tableHeader", content: [{ type: "paragraph" }] }] }, ...Array.from({ length: 2 }, () => ({ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }, { type: "tableCell", content: [{ type: "paragraph" }] }] }))] }).run() },
  { label: "Image", detail: "Embed from URL", keywords: "picture photo media", run: (editor) => {
    const input = window.prompt("Image URL");
    if (!input) return;
    try {
      const url = new URL(input.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") return;
      editor.chain().focus().insertContent({ type: "imageEmbed", attrs: { src: url.toString(), alt: "" } }).run();
    } catch {
      // Ignore malformed image URLs.
    }
  } },
  { label: "Bold", detail: "Bold text", keywords: "strong", run: (editor) => editor.chain().focus().toggleBold().run() },
  { label: "Italic", detail: "Italic text", keywords: "emphasis", run: (editor) => editor.chain().focus().toggleItalic().run() },
  { label: "Underline", detail: "Underlined text", keywords: "underlined", run: (editor) => editor.chain().focus().toggleUnderline().run() },
  { label: "Strikethrough", detail: "Crossed out text", keywords: "strike", run: (editor) => editor.chain().focus().toggleStrike().run() },
];

const EditorBlockShortcuts = Extension.create({
  name: "editorBlockShortcuts",
  addKeyboardShortcuts() {
    return {
      "Mod-Alt-0": () => this.editor.chain().focus().setParagraph().run(),
      "Mod-Alt-1": () => this.editor.chain().focus().setHeading({ level: 1 }).run(),
      "Mod-Alt-2": () => this.editor.chain().focus().setHeading({ level: 2 }).run(),
      "Mod-Shift-8": () => this.editor.chain().focus().toggleBulletList().run(),
      "Mod-Shift-7": () => this.editor.chain().focus().toggleOrderedList().run(),
      "Mod-Shift-9": () => this.editor.chain().focus().toggleBlockquote().run(),
      "Mod-Alt-c": () => this.editor.chain().focus().toggleCodeBlock().run(),
      "Mod-Alt-d": () => this.editor.chain().focus().setHorizontalRule().run(),
    };
  },
});

type SlashMenuState = { from: number; to: number; query: string; x: number; y: number } | null;

export function PageEditor({ id }: { id: string }) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [error, setError] = useState("");
  const [draftWarning, setDraftWarning] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [recoveredDraft, setRecoveredDraft] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInProgress = useRef(false);
  const dirty = useRef(false);
  const draftRevision = useRef(0);
  const draftStorageKey = `kbs:page-draft:${id}`;
  const latestContent = useRef<{
    content: string;
    contentJson: Record<string, unknown>;
    revision: number;
  }>({
    content: "",
    contentJson: {},
    revision: 0,
  });
  const [parentId, setParentId] = useState<string | null>(null);
  const [allPages, setAllPages] = useState<
    { id: string; title: string; parentId: string | null }[]
  >([]);
  const [moving, setMoving] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [icon, setIcon] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [coverImageError, setCoverImageError] = useState<"invalid" | "load" | null>(null);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashMenuRef = useRef<SlashMenuState>(null);
  const slashIndexRef = useRef(0);
  const filteredCommands = slashCommands.filter((command) =>
    `${command.label} ${command.keywords}`.toLowerCase().includes(slashMenu?.query.toLowerCase() ?? ""),
  );

  useEffect(() => { slashMenuRef.current = slashMenu; }, [slashMenu]);
  useEffect(() => { slashIndexRef.current = slashIndex; }, [slashIndex]);


  const editor = useEditor({
    extensions: [StarterKit, EditorBlockShortcuts, ImageExtension, TableExtension, TableRowExtension, TableHeaderExtension, TableCellExtension, TaskListExtension, TaskItemExtension, CalloutExtension, ToggleExtension, DatabaseEmbedExtension],
    immediatelyRender: false,
    content: "",
    editable: false,
    editorProps: {
      attributes: {
        class:
          "min-h-[45vh] outline-none prose prose-neutral max-w-none dark:prose-invert sm:min-h-[400px]",
      },
      handleKeyDown: (_view, event) => {
        const menu = slashMenuRef.current;
        if (!menu) return false;
        const available = slashCommands.filter((command) =>
          `${command.label} ${command.keywords}`.toLowerCase().includes(menu.query.toLowerCase()),
        );
        if (event.key === "ArrowDown" && available.length) {
          event.preventDefault();
          setSlashIndex((index) => (index + 1) % available.length);
          return true;
        }
        if (event.key === "ArrowUp" && available.length) {
          event.preventDefault();
          setSlashIndex((index) => (index - 1 + available.length) % available.length);
          return true;
        }
        if (event.key === "Escape") {
          setSlashMenu(null);
          return true;
        }
        if (event.key === "Enter" && available.length) {
          event.preventDefault();
          const command = available[slashIndexRef.current % available.length];
          editor?.chain().focus().deleteRange({ from: menu.from, to: menu.to }).run();
          command.run(editor!);
          setSlashMenu(null);
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const updateSlashMenu = () => {
      const { $from, empty } = editor.state.selection;
      if (!empty || $from.parent.type.name !== "paragraph") {
        setSlashMenu(null);
        return;
      }
      const beforeCursor = $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc");
      const match = /(?:^|\s)\/([\w-]*)$/.exec(beforeCursor);
      if (!match) {
        setSlashMenu(null);
        return;
      }
      const from = $from.pos - match[0].length + match[0].lastIndexOf("/");
      const coords = editor.view.coordsAtPos($from.pos);
      setSlashIndex(0);
      setSlashMenu({ from, to: $from.pos, query: match[1], x: coords.left, y: coords.bottom + 6 });
    };
    editor.on("selectionUpdate", updateSlashMenu);
    editor.on("transaction", updateSlashMenu);
    updateSlashMenu();
    return () => {
      editor.off("selectionUpdate", updateSlashMenu);
      editor.off("transaction", updateSlashMenu);
    };
  }, [editor]);

  useEffect(() => {
  let cancelled = false;

  async function loadPages() {
    try {
      const response = await fetch("/api/pages");

      if (!response.ok) {
        throw new Error("Unable to load pages.");
      }

      const data = await response.json();

      if (!cancelled) {
        setAllPages(data);
      }
    } catch (error) {
      console.error("Failed to load pages:", error);
    }
  }

  void loadPages();

  return () => {
    cancelled = true;
  };
}, [id]);

  useEffect(() => {
    let cancelled = false;

    async function loadPage() {
      try {
        setStatus("loading");
        const response = await fetch(`/api/pages/${id}`);

        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "Page not found."
              : "Unable to load page.",
          );
        }

        const page: PageData = await response.json();

        if (cancelled) return;

        setTitle(page.title);
        setParentId(page.parentId ?? null);
        setIsFavorite(page.isFavorite ?? false);
        setIcon(page.icon ?? "");
        setCoverImageUrl(page.coverImageUrl ?? "");
        setCoverImageError(null);
        const serverContentJson = page.contentJson?.type
          ? page.contentJson as Parameters<NonNullable<typeof editor>["commands"]["setContent"]>[0]
          : page.content || "";
        let recovered = null;
        try {
          const serializedDraft = localStorage.getItem(draftStorageKey);
          recovered = readRecoverablePageDraft(serializedDraft, page.updatedAt);
          if (serializedDraft && !recovered) localStorage.removeItem(draftStorageKey);
        } catch {
          // Local draft storage can be unavailable in private browsing contexts.
        }
        const contentToLoad = recovered?.contentJson ?? serverContentJson;
        latestContent.current = {
          content: recovered?.content ?? page.content ?? "",
          contentJson: recovered?.contentJson ?? (page.contentJson ?? {}),
          revision: recovered?.revision ?? 0,
        };
        draftRevision.current = recovered?.revision ?? 0;
        dirty.current = Boolean(recovered);
        setRecoveredDraft(Boolean(recovered));
        editor?.commands.setContent(
          contentToLoad,
        );
        setLoaded(true);
        setStatus("saved");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Unable to load page.");
          setStatus("error");
        }
      }
    }

    if (editor) {
      void loadPage();
    }

    return () => {
      cancelled = true;
    };
  }, [editor, id, loadAttempt, draftStorageKey]);

  const savePage = useCallback(
  async (updates: {
    title?: string;
    content?: string;
    contentJson?: Record<string, unknown>;
    icon?: string | null;
    coverImageUrl?: string | null;
  }, options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setStatus("saving");
      setError("");
    }

    try {
      const response = await fetch(`/api/pages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error("Save failed. Please try again.");
      }

      if (!options.silent) setStatus("saved");
      return true;
    } catch (e) {
      if (!options.silent) {
        setError(e instanceof Error ? e.message : "Save failed.");
        setStatus("error");
      }
      return false;
    }
  },
  [id],
);

useEffect(() => {
  if (!editor || !loaded) return;

  let cancelled = false;

  async function flushSave(silent = false) {
    if (saveInProgress.current || !dirty.current) return;

    saveInProgress.current = true;
    dirty.current = false;

    const snapshot = { ...latestContent.current };
    const { revision, ...updates } = snapshot;

    try {
      const saved = await savePage(updates, { silent });
      if (saved && revision === draftRevision.current) {
        try {
          const storedDraft = readRecoverablePageDraft(localStorage.getItem(draftStorageKey), new Date(0));
          if (!storedDraft || storedDraft.revision === revision) localStorage.removeItem(draftStorageKey);
        } catch {
          // The server save succeeded even if local draft cleanup is unavailable.
        }
        dirty.current = false;
        if (!silent) {
          setRecoveredDraft(false);
          setDraftWarning("");
        }
      }
    } finally {
      saveInProgress.current = false;

      if (dirty.current) {
        void flushSave(silent || cancelled);
      }
    }
  }

  const handleUpdate = () => {
    const revision = draftRevision.current + 1;
    latestContent.current = {
      content: editor.getText(),
      contentJson: editor.getJSON() as Record<string, unknown>,
      revision,
    };
    draftRevision.current = revision;

    dirty.current = true;
    setStatus("saving");
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({
        ...latestContent.current,
        savedAt: Date.now(),
      }));
    } catch {
      setDraftWarning("Local draft recovery is unavailable in this browser.");
    }

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }

    saveTimer.current = setTimeout(() => {
      void flushSave();
    }, 800);
  };

  editor.setEditable(true);
  editor.on("update", handleUpdate);

  if (dirty.current) {
    saveTimer.current = setTimeout(() => void flushSave(), 800);
  }

  return () => {
    cancelled = true;
    editor.off("update", handleUpdate);

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    if (dirty.current) void flushSave(true);
  };
}, [editor, loaded, savePage, draftStorageKey]);

async function retryContentSave() {
  if (!editor) return;
  const revision = draftRevision.current;
  const saved = await savePage({
    title: title.trim() || "Untitled",
    content: editor.getText(),
    contentJson: editor.getJSON() as Record<string, unknown>,
  });
  if (saved && revision === draftRevision.current) {
    dirty.current = false;
    setRecoveredDraft(false);
    setDraftWarning("");
    try {
      localStorage.removeItem(draftStorageKey);
    } catch {
      // The server copy is saved; an uncleared local draft is ignored when stale.
    }
  }
}

async function movePage(newParentId: string) {
  const nextParentId = newParentId || null;

  if (nextParentId === parentId) return;

  setMoving(true);
  setError("");

  try {
    const response = await fetch(`/api/pages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentId: nextParentId,
      }),
    });

    if (!response.ok) {
      throw new Error("Unable to move page.");
    }

    setParentId(nextParentId);

    window.dispatchEvent(new Event("pages-updated"));
  } catch (error) {
    setError(
      error instanceof Error ? error.message : "Unable to move page."
    );
  } finally {
    setMoving(false);
  }
}

async function toggleFavorite() {
  setFavoriteSaving(true);
  setError("");
  try {
    const nextFavorite = !isFavorite;
    const response = await fetch(`/api/pages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFavorite: nextFavorite }),
    });
    if (!response.ok) throw new Error("Could not update favorite.");
    setIsFavorite(nextFavorite);
  } catch (favoriteError) {
    setError(favoriteError instanceof Error ? favoriteError.message : "Could not update favorite.");
  } finally {
    setFavoriteSaving(false);
  }
}

function exportMarkdown() {
  if (!editor) return;
  const safeTitle = (title.trim() || "Untitled").replace(/[\\/:*?"<>|]/g, "-");
  const markdown = `# ${title.trim() || "Untitled"}\n\n${tiptapToMarkdown(editor.getJSON() as Record<string, unknown>)}\n`;
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeTitle}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const unavailableParentIds = new Set([id]);

let foundDescendant = true;

while (foundDescendant) {
  foundDescendant = false;

  for (const page of allPages) {
    if (
      page.parentId &&
      unavailableParentIds.has(page.parentId) &&
      !unavailableParentIds.has(page.id)
    ) {
      unavailableParentIds.add(page.id);
      foundDescendant = true;
    }
  }
}

  if (status === "loading" && !loaded) {
    return (
      <div role="status" aria-label="Loading page" className="animate-pulse space-y-6">
        <div className="h-10 w-2/3 rounded bg-muted" />
        <div className="h-9 w-48 rounded bg-muted/70" />
        <div className="h-32 rounded-lg border bg-muted/10" />
        <div className="h-64 rounded-lg border bg-muted/10" />
      </div>
    );
  }

  if (!loaded) {
    return (
      <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 p-4">
        <p className="text-sm text-destructive">{error || "Unable to open this page."}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => { setError(""); setStatus("loading"); setLoadAttempt((attempt) => attempt + 1); }}>Try again</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-7">
      <div className="flex min-w-0 flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        {icon && <span aria-hidden="true" className="shrink-0 text-3xl leading-none">{icon}</span>}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void savePage({ title: title.trim() || "Untitled" })}
          aria-label="Page title"
          className="w-full min-w-0 bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50 sm:text-4xl"
        />

        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportMarkdown}
            disabled={!editor}
          >
            <Download size={15} /> Export Markdown
          </Button>
          <button
            type="button"
            onClick={() => void toggleFavorite()}
            disabled={favoriteSaving}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Star size={18} className={isFavorite ? "fill-current text-amber-500" : ""} />
          </button>
          <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {status === "saving" && "Saving…"}
            {status === "saved" && "Saved"}
            {status === "error" && "Save failed"}
            {status === "loading" && "Loading…"}
          </span>
        </div>
      </div>
      <section aria-label="Page appearance" className="space-y-3">
        {coverImageUrl && coverImageError !== "invalid" && coverImageError !== "load" && (
          <div className="relative overflow-hidden rounded-xl border bg-muted/30">
            <Image
              src={coverImageUrl}
              alt=""
              width={1600}
              height={500}
              unoptimized
              loading="lazy"
              className="h-40 w-full object-cover sm:h-52"
              onError={() => setCoverImageError("load")}
            />
          </div>
        )}
        {coverImageError && (
          <p role="status" className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-muted-foreground">
            {coverImageError === "invalid"
              ? "Enter a valid image URL starting with http:// or https://."
              : "Cover image could not be loaded. Check the URL or remove it below."}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
            <span className="text-muted-foreground">Icon</span>
            <input
              aria-label="Page icon"
              value={icon}
              maxLength={8}
              placeholder="＋"
              onChange={(event) => setIcon(event.target.value)}
              onBlur={() => void savePage({ icon: icon.trim() || null })}
              className="w-12 bg-transparent text-center text-lg outline-none"
            />
          </label>
          <label className="flex min-w-64 flex-1 items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <span className="shrink-0 text-muted-foreground">Cover image URL</span>
            <input
              aria-label="Cover image URL"
              value={coverImageUrl}
              placeholder="https://…"
              onChange={(event) => { setCoverImageUrl(event.target.value); setCoverImageError(null); }}
              onBlur={() => {
                const value = coverImageUrl.trim();
                if (!value) {
                  void savePage({ coverImageUrl: null });
                  return;
                }
                try {
                  const url = new URL(value);
                  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Invalid protocol");
                  setCoverImageUrl(url.toString());
                  void savePage({ coverImageUrl: url.toString() });
                } catch {
                  setCoverImageError("invalid");
                }
              }}
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
          </label>
        </div>
      </section>
      {recoveredDraft && (
        <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
          Recovered unsaved changes from this device. Saving them now…
        </p>
      )}
      {draftWarning && <p role="status" className="text-xs text-muted-foreground">{draftWarning}</p>}
      <details className="group rounded-xl border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block font-medium">Page details</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Organization, tags, and linked pages
            </span>
          </span>
          <ChevronDown
            size={17}
            aria-hidden="true"
            className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="grid gap-6 border-t p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="move-page" className="text-sm font-medium">
              Move to
            </label>
            <select
              id="move-page"
              value={parentId ?? ""}
              onChange={(event) => void movePage(event.target.value)}
              disabled={moving}
              className="min-w-0 max-w-full rounded-md border bg-background px-3 py-2 text-sm sm:max-w-xs"
            >
              <option value="">Top level</option>
              {allPages
                .filter((page) => !unavailableParentIds.has(page.id))
                .map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.title || "Untitled"}
                  </option>
                ))}
            </select>
            {moving && (
              <span className="text-xs text-muted-foreground">Moving…</span>
            )}
          </div>
          <PageTags pageId={id} />
          <PageLinks pageId={id} pages={allPages} />
        </div>
      </details>

      {error && (
        <div role="alert" className="text-sm text-destructive">
          {error}
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={() => void retryContentSave()}
          >
            Retry save
          </Button>
        </div>
      )}

      <div className="rounded-xl border bg-card px-4 py-4 sm:px-8 sm:py-7">
        <EditorToolbar editor={editor} />
        <div className="border-b py-3">
          <DatabaseEmbedPicker editor={editor} />
        </div>
        <div className="overflow-x-auto">
          <EditorContent editor={editor} />
        </div>
        {slashMenu && filteredCommands.length > 0 && (
          <div
            role="listbox"
            aria-label="Insert block"
            className="fixed z-50 w-72 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
            style={{ left: Math.min(slashMenu.x, window.innerWidth - 300), top: slashMenu.y }}
          >
            {filteredCommands.map((command, index) => (
              <button
                key={command.label}
                type="button"
                role="option"
                aria-selected={index === slashIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setSlashIndex(index)}
                onClick={() => {
                  if (!editor || !slashMenu) return;
                  editor.chain().focus().deleteRange({ from: slashMenu.from, to: slashMenu.to }).run();
                  command.run(editor);
                  setSlashMenu(null);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left ${index === slashIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
              >
                <span className="text-sm font-medium">{command.label}</span>
                <span className="text-xs text-muted-foreground">{command.detail}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
