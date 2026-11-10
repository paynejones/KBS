
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, GripVertical, Pencil, Plus, SlidersHorizontal, Star, Trash2 } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { Extension, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DatabaseEmbedExtension, DatabaseEmbedPicker } from "@/components/database-embed";
import { CalloutExtension, TaskItemExtension, TaskListExtension, ToggleExtension } from "@/components/task-list-extension";
import { TableCellExtension, TableExtension, TableHeaderExtension, TableRowExtension } from "@/components/table-extension";
import { ImageExtension } from "@/components/image-extension";
import { MediaImage } from "@/components/media-image";
import { isAllowedMediaUrl, pickLocalFile, uploadAttachment } from "@/lib/media";
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
import { EditorToolbar } from "@/components/editor-toolbar";
import { PageTags } from "@/components/page-tags";
import { PageLinks } from "@/components/page-links";
import { RelatedPages } from "@/components/related-pages";
import { PageRail } from "@/components/page-rail";
import { tiptapToMarkdown } from "@/lib/markdown";
import { readRecoverablePageDraft, type PageDraft } from "@/lib/page-draft";
import { recordRecentPage } from "@/lib/recents";
import { clampEditorPopover } from "@/lib/editor-popover";
import { moveBlockAtSelection, selectedBlockGroup } from "@/lib/editor-block-move";
import { buildBlockDragImage } from "@/lib/editor-drag-image";
import { collectLinkedPageIds, diffLinkedPageIds } from "@/lib/page-link-sync";
import { describeSaveState, type SaveStatusView } from "@/lib/save-status";

type PageData = {
  id: string;
  title: string;
  content: string;
  contentJson: Record<string, unknown>;
  parentId: string | null;
  isFavorite: boolean;
  icon: string | null;
  coverImageUrl: string | null;
  selectedText: string | null;
  updatedAt: string;
  createdAt?: string;
};

type SaveStatus = "loading" | "dirty" | "saving" | "saved" | "error";
type PageRevision = { id: string; title: string; content: string; createdAt: string };

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
  { label: "Image", detail: "Upload or drop an image", keywords: "picture photo media upload", run: (editor) => {
    void (async () => {
      const file = await pickLocalFile("image/jpeg,image/png,image/gif,image/webp,image/avif");
      if (!file) return;
      try {
        const uploaded = await uploadAttachment(file);
        editor.chain().focus().insertContent({ type: "imageEmbed", attrs: { src: uploaded.url, alt: "" } }).run();
      } catch {
        editor.view.dom.dispatchEvent(new CustomEvent("kbs-media-error", {
          bubbles: true,
          detail: "Could not upload the image.",
        }));
      }
    })();
  } },
  { label: "Image from URL", detail: "Embed a remote image", keywords: "picture photo media link", run: (editor) => {
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

function moveSelectedBlock(editor: Editor, direction: -1 | 1) {
  const transaction = moveBlockAtSelection(editor.state, direction);
  if (!transaction) return false;
  editor.view.dispatch(transaction);
  return true;
}

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
      "Alt-Shift-ArrowUp": () => moveSelectedBlock(this.editor, -1),
      "Alt-Shift-ArrowDown": () => moveSelectedBlock(this.editor, 1),
    };
  },
});

type SlashMenuState = { from: number; to: number; query: string; x: number; y: number } | null;
type WikiMenuState = { from: number; to: number; query: string; x: number; y: number } | null;
type PageOption = { id: string; title: string; parentId: string | null };

const EDITOR_MENU_SIZE = { width: 320, height: 320 };

function collectOutline(target: Editor) {
  const outline: { level: number; text: string }[] = [];

  target.state.doc.descendants((node) => {
    if (node.type.name === "heading" && node.textContent.trim()) {
      outline.push({
        level: typeof node.attrs.level === "number" ? node.attrs.level : 1,
        text: node.textContent.trim(),
      });
    }
  });

  return outline;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

const SAVE_TONE_CLASSES: Record<SaveStatusView["tone"], string> = {
  muted: "text-muted-foreground",
  active: "text-muted-foreground",
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
};

function editorMenuPlacement(anchor: { x: number; y: number }) {
  if (typeof window === "undefined") {
    return {
      left: anchor.x,
      top: anchor.y,
      width: EDITOR_MENU_SIZE.width,
      maxHeight: EDITOR_MENU_SIZE.height,
    };
  }
  const viewport = window.visualViewport;
  return clampEditorPopover(
    anchor,
    EDITOR_MENU_SIZE,
    viewport
      ? { width: viewport.width, height: viewport.height }
      : { width: window.innerWidth, height: window.innerHeight },
  );
}

export function PageEditor({ id, hideTitle = false }: { id: string; hideTitle?: boolean }) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [statusClock, setStatusClock] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [draftWarning, setDraftWarning] = useState("");
  const [linkSyncWarning, setLinkSyncWarning] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [recoveredDraft, setRecoveredDraft] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<PageDraft | null>(null);
  const [headings, setHeadings] = useState<{ level: number; text: string }[]>([]);
  const [wordCount, setWordCount] = useState(0);
  const [createdAt, setCreatedAt] = useState("");

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
  const linkedPageIds = useRef<Set<string>>(new Set());
  const relinkBaseline = useRef(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [allPages, setAllPages] = useState<
    { id: string; title: string; parentId: string | null }[]
  >([]);
  const [moving, setMoving] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [icon, setIcon] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [quoteEditing, setQuoteEditing] = useState(false);
  const [quoteDraft, setQuoteDraft] = useState("");
  const [quoteSaving, setQuoteSaving] = useState(false);
  const [coverImageError, setCoverImageError] = useState<"invalid" | "load" | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [revisions, setRevisions] = useState<PageRevision[]>([]);
  const [revisionPendingRestore, setRevisionPendingRestore] = useState<PageRevision | null>(null);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [revisionError, setRevisionError] = useState("");
  const [restoringRevision, setRestoringRevision] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateMessage, setTemplateMessage] = useState("");
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashMenuRef = useRef<SlashMenuState>(null);
  const slashIndexRef = useRef(0);
  const [wikiMenu, setWikiMenu] = useState<WikiMenuState>(null);
  const [wikiIndex, setWikiIndex] = useState(0);
  const wikiMenuRef = useRef<WikiMenuState>(null);
  const wikiIndexRef = useRef(0);
  const matchingWikiPagesRef = useRef<PageOption[]>([]);
  const wikiCreateAllowedRef = useRef(false);
  const wikiMenuOptionCountRef = useRef(0);
  const matchingWikiPages = useMemo(
    () => wikiMenu
      ? allPages.filter((page) => page.id !== id && page.title.toLowerCase().includes(wikiMenu.query.trim().toLowerCase())).slice(0, 7)
      : [],
    [allPages, id, wikiMenu],
  );
  const canCreateWikiPage = Boolean(wikiMenu?.query.trim()) && !allPages.some((page) => page.title.toLowerCase() === wikiMenu?.query.trim().toLowerCase());
  const wikiMenuOptionCount = matchingWikiPages.length + (canCreateWikiPage ? 1 : 0);
  const filteredCommands = slashCommands.filter((command) =>
    `${command.label} ${command.keywords}`.toLowerCase().includes(slashMenu?.query.toLowerCase() ?? ""),
  );

  useEffect(() => { slashMenuRef.current = slashMenu; }, [slashMenu]);
  useEffect(() => { slashIndexRef.current = slashIndex; }, [slashIndex]);
  useEffect(() => { wikiMenuRef.current = wikiMenu; }, [wikiMenu]);
  useEffect(() => { wikiIndexRef.current = wikiIndex; }, [wikiIndex]);
  useEffect(() => {
    matchingWikiPagesRef.current = matchingWikiPages;
    wikiCreateAllowedRef.current = canCreateWikiPage;
    wikiMenuOptionCountRef.current = wikiMenuOptionCount;
  }, [matchingWikiPages, canCreateWikiPage, wikiMenuOptionCount]);


  useEffect(() => {
    if (!lastSavedAt) return;
    const interval = setInterval(() => setStatusClock(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [lastSavedAt]);

  useEffect(() => {
    if (!linkSyncWarning) return;
    const timer = setTimeout(() => setLinkSyncWarning(""), 8000);
    return () => clearTimeout(timer);
  }, [linkSyncWarning]);

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, HTMLAttributes: { class: "text-primary underline underline-offset-2" } } }), EditorBlockShortcuts, ImageExtension, TableExtension, TableRowExtension, TableHeaderExtension, TableCellExtension, TaskListExtension, TaskItemExtension, CalloutExtension, ToggleExtension, DatabaseEmbedExtension],
    immediatelyRender: false,
    content: "",
    editable: false,
    editorProps: {
      attributes: {
        class:
          "min-h-[45vh] outline-none prose prose-neutral max-w-none dark:prose-invert sm:min-h-[400px]",
        "aria-label": "Page content",
        "aria-keyshortcuts": "Alt+Shift+ArrowUp Alt+Shift+ArrowDown",
      },
      handleKeyDown: (_view, event) => {
        const wikiMenu = wikiMenuRef.current;
        if (wikiMenu) {
          if (event.key === "ArrowDown" && wikiMenuOptionCountRef.current > 0) {
            event.preventDefault();
            setWikiIndex((index) => (index + 1) % wikiMenuOptionCountRef.current);
            return true;
          }
          if (event.key === "ArrowUp" && wikiMenuOptionCountRef.current > 0) {
            event.preventDefault();
            setWikiIndex((index) => (index - 1 + wikiMenuOptionCountRef.current) % wikiMenuOptionCountRef.current);
            return true;
          }
          if (event.key === "Escape") {
            setWikiMenu(null);
            return true;
          }
          if (event.key === "Enter" && wikiMenuOptionCountRef.current > 0) {
            event.preventDefault();
            const selectedPage = matchingWikiPagesRef.current[wikiIndexRef.current];
            if (selectedPage) void insertWikiPage(selectedPage, wikiMenu);
            else if (wikiCreateAllowedRef.current) void createWikiPage(wikiMenu);
            return true;
          }
        }
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
    const onMediaError = (event: Event) => {
      const detail = "detail" in event ? String((event as CustomEvent).detail ?? "") : "";
      setError(detail || "Could not upload the image.");
    };
    editor.view.dom.addEventListener("kbs-media-error", onMediaError);
    return () => editor.view.dom.removeEventListener("kbs-media-error", onMediaError);
  }, [editor]);

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
    if (!editor) return;
    const updateWikiMenu = () => {
      const { $from, empty } = editor.state.selection;
      if (!empty || $from.parent.type.name !== "paragraph") {
        setWikiMenu(null);
        return;
      }
      const beforeCursor = $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc");
      const match = /(?:^|\s)\[\[([^\]]*)$/.exec(beforeCursor);
      if (!match) {
        setWikiMenu(null);
        return;
      }
      const from = $from.pos - match[1].length - 2;
      const coords = editor.view.coordsAtPos($from.pos);
      setWikiIndex(0);
      setWikiMenu({ from, to: $from.pos, query: match[1], x: coords.left, y: coords.bottom + 6 });
    };
    editor.on("selectionUpdate", updateWikiMenu);
    editor.on("transaction", updateWikiMenu);
    updateWikiMenu();
    return () => {
      editor.off("selectionUpdate", updateWikiMenu);
      editor.off("transaction", updateWikiMenu);
    };
  }, [editor]);

  async function attachPageLink(targetPageId: string) {
    const response = await fetch(`/api/pages/${id}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPageId, origin: "inline" }),
    });
    if (!response.ok) throw new Error("The page link could not be saved.");
  }

  async function insertWikiPage(page: PageOption, menu = wikiMenuRef.current) {
    if (!editor || !menu) return;
    editor.commands.focus();
    try {
      await attachPageLink(page.id);
      editor.chain().focus().deleteRange({ from: menu.from, to: menu.to })
        .insertContent({ type: "text", text: page.title || "Untitled", marks: [{ type: "link", attrs: { href: `/pages/${page.id}` } }] })
        .run();
      setWikiMenu(null);
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "The page link could not be saved.");
    }
  }

  async function createWikiPage(menu = wikiMenuRef.current) {
    if (!editor || !menu?.query.trim()) return;
    editor.commands.focus();
    const pageTitle = menu.query.trim().slice(0, 200);
    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: pageTitle }),
      });
      const page: PageOption = await response.json();
      if (!response.ok) throw new Error("Could not create the linked page.");
      setAllPages((current) => [...current, page]);
      await insertWikiPage(page, menu);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the linked page.");
    }
  }

  useEffect(() => {
  let cancelled = false;    async function loadPages() {
    try {
      // The filtered list keeps record pages out of the Move to menu, the
      // page-link pickers, and [[]] autocomplete: a record page belongs to its
      // record and is reached through that record, not as a page to file away.
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
        setSelectedText(page.selectedText ?? "");
        setCoverImageError(null);
        setCreatedAt(page.createdAt ?? "");
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
        const contentToLoad = serverContentJson;
        latestContent.current = {
          content: page.content ?? "",
          contentJson: page.contentJson ?? {},
          revision: 0,
        };
        draftRevision.current = 0;
        dirty.current = false;
        setRecoveredDraft(false);
        setPendingDraft(recovered);
        // Content loading is not a link edit, so the update it emits re-baselines
        // instead of releasing connections for the page that was open before.
        relinkBaseline.current = true;
        editor?.commands.setContent(
          contentToLoad,
        );
        if (editor) {
          relinkBaseline.current = false;
          linkedPageIds.current = collectLinkedPageIds(editor.state.doc);
          setHeadings(collectOutline(editor));
          setWordCount(countWords(editor.getText()));
        }
        setLoaded(true);
        recordRecentPage({ id, title: page.title });
        setLastSavedAt(Date.parse(page.updatedAt) || Date.now());
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

  useEffect(() => {
    if (!loaded) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [loaded]);

  const savePage = useCallback(
  async (updates: {
    title?: string;
    content?: string;
    contentJson?: Record<string, unknown>;
    icon?: string | null;
    coverImageUrl?: string | null;
    selectedText?: string | null;
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

      if (!options.silent) {
        setLastSavedAt(Date.now());
        setStatus("saved");
      }
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

const markSaved = useCallback(() => {
  setLastSavedAt(Date.now());
}, []);

  /** Corrects or clears the captured quote through the same page save path. */
  const saveQuote = useCallback(
    async (next: string | null) => {
      setQuoteSaving(true);
      const saved = await savePage({ selectedText: next });
      setQuoteSaving(false);
      if (!saved) return;
      setSelectedText(next ?? "");
      setQuoteEditing(false);
    },
    [savePage],
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

  /** Mirrors an inline page link appearing or disappearing into its connection. */
  async function syncInlineConnection(targetPageId: string, action: "add" | "remove") {
    try {
      const response = await fetch(`/api/pages/${id}/links`, {
        method: action === "add" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPageId, origin: "inline" }),
      });
      if (!response.ok) throw new Error("The page connection could not be synced.");
      setLinkSyncWarning("");
    } catch (syncError) {
      // Editing must not be interrupted for a connection that trails behind the
      // text, so the failure is reported quietly and the text still saves.
      console.error("Failed to sync an inline page connection:", syncError);
      setLinkSyncWarning(
        "A page connection could not be updated, so linked pages may be out of date.",
      );
    }
  }

  const handleUpdate = () => {
    const nextLinkedPageIds = collectLinkedPageIds(editor.state.doc);
    if (relinkBaseline.current) {
      relinkBaseline.current = false;
      linkedPageIds.current = nextLinkedPageIds;
    } else {
      const { added, removed } = diffLinkedPageIds(linkedPageIds.current, nextLinkedPageIds);
      linkedPageIds.current = nextLinkedPageIds;
      for (const targetPageId of removed) void syncInlineConnection(targetPageId, "remove");
      for (const targetPageId of added) void syncInlineConnection(targetPageId, "add");
    }

    setHeadings(collectOutline(editor));
    setWordCount(countWords(editor.getText()));
    const revision = draftRevision.current + 1;
    latestContent.current = {
      content: editor.getText(),
      contentJson: editor.getJSON() as Record<string, unknown>,
      revision,
    };
    draftRevision.current = revision;

    dirty.current = true;
    setStatus("dirty");
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
}, [editor, id, loaded, savePage, draftStorageKey]);

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

function recoverLocalDraft() {
  if (!editor || !pendingDraft) return;
  draftRevision.current = pendingDraft.revision;
  setRecoveredDraft(true);
  editor.commands.setContent(pendingDraft.contentJson as Parameters<typeof editor.commands.setContent>[0]);
  setPendingDraft(null);
}

/** The document position of the nth outline heading, matching PageRail's list. */
function findHeadingPosition(target: Editor, index: number): number | null {
  let seen = 0;
  let found: number | null = null;
  target.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name !== "heading" || !node.textContent.trim()) return true;
    if (seen === index) {
      found = pos + 1;
      return false;
    }
    seen += 1;
    return true;
  });
  return found;
}

function focusHeading(index: number) {
  if (!editor) return;
  const position = findHeadingPosition(editor, index);
  if (position === null) return;
  // An outline entry is a jump within the document, so put the caret in the
  // heading as well as scrolling to it.
  editor.chain().focus().setTextSelection(position).run();
  editor.view.dom
    .querySelectorAll("h1, h2, h3")[index]
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function discardLocalDraft() {
  try {
    localStorage.removeItem(draftStorageKey);
  } catch {
    setDraftWarning("This browser could not remove the local recovered draft.");
  }
  setPendingDraft(null);
}

async function uploadCoverImage() {
  setCoverUploading(true);
  setCoverImageError(null);
  setError("");
  try {
    const file = await pickLocalFile("image/jpeg,image/png,image/gif,image/webp,image/avif");
    if (!file) return;
    const uploaded = await uploadAttachment(file);
    setCoverImageUrl(uploaded.url);
    await savePage({ coverImageUrl: uploaded.url });
  } catch (uploadError) {
    setError(uploadError instanceof Error ? uploadError.message : "Could not upload the cover image.");
  } finally {
    setCoverUploading(false);
  }
}

function saveCoverFromInput() {
  const value = coverImageUrl.trim();
  if (!value) {
    void savePage({ coverImageUrl: null });
    return;
  }
  if (!isAllowedMediaUrl(value)) {
    setCoverImageError("invalid");
    return;
  }
  setCoverImageUrl(value);
  void savePage({ coverImageUrl: value });
}

async function loadRevisions() {
  setLoadingRevisions(true);
  setRevisionError("");
  try {
    const response = await fetch(`/api/pages/${id}/revisions`);
    if (!response.ok) throw new Error("Unable to load page history.");
    setRevisions(await response.json() as PageRevision[]);
  } catch (historyError) {
    setRevisionError(historyError instanceof Error ? historyError.message : "Unable to load page history.");
  } finally {
    setLoadingRevisions(false);
  }
}

async function restoreRevision(revisionId: string) {
  setRestoringRevision(revisionId);
  setRevisionError("");
  try {
    const response = await fetch(`/api/pages/${id}/revisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisionId }),
    });
    if (!response.ok) throw new Error("Unable to restore this version.");
    const page = await response.json() as PageData;
    setTitle(page.title);
    editor?.commands.setContent(page.contentJson as Parameters<typeof editor.commands.setContent>[0]);
    markSaved();
    setStatus("saved");
    await loadRevisions();
  } catch (historyError) {
    setRevisionError(historyError instanceof Error ? historyError.message : "Unable to restore this version.");
  } finally {
    setRestoringRevision("");
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

async function saveAsTemplate() {
  const suggested = title.trim() || "Untitled";
  const name = window.prompt("Name this template", suggested);
  if (!name?.trim()) return;

  setTemplateSaving(true);
  setTemplateMessage("");

  try {
    const response = await fetch("/api/page-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), pageId: id }),
    });
    if (!response.ok) throw new Error("Could not save the template.");
    setTemplateMessage(`Saved “${name.trim()}” as a template.`);
  } catch (templateError) {
    setTemplateMessage(templateError instanceof Error ? templateError.message : "Could not save the template.");
  } finally {
    setTemplateSaving(false);
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

  const wikiMenuPlacement = wikiMenu ? editorMenuPlacement(wikiMenu) : null;
  const slashMenuPlacement = slashMenu ? editorMenuPlacement(slashMenu) : null;
  const saveView = describeSaveState(status, lastSavedAt, statusClock);

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
    <div className="mx-auto max-w-6xl">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_11rem] xl:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="min-w-0 space-y-6">
      <div className="flex min-w-0 flex-col gap-4 border-b pb-5 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        {!hideTitle && (
          <>
            {icon && !coverImageUrl && <span aria-hidden="true" className="shrink-0 text-3xl leading-none">{icon}</span>}
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setStatus("dirty");
              }}
              onBlur={() => {
                recordRecentPage({ id, title: title.trim() || "Untitled" });
                void savePage({ title: title.trim() || "Untitled" });
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                // Enter in the title starts the body instead of doing nothing:
                // the caret lands at the first block, ready to write.
                event.preventDefault();
                recordRecentPage({ id, title: title.trim() || "Untitled" });
                void savePage({ title: title.trim() || "Untitled" });
                editor?.commands.focus("start");
              }}
              aria-label="Page title"
              className="w-full min-w-0 bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50 sm:text-4xl lg:flex-1"
            />
          </>
        )}

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
          <span
            className={`text-xs ${SAVE_TONE_CLASSES[saveView.tone]}`}
            role="status"
            aria-live="polite"
            title={lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleString()}` : undefined}
          >
            {saveView.label}
          </span>
        </div>
      </div>
      <div className="space-y-3">
        {coverImageUrl && coverImageError !== "invalid" && (
          <div className="relative overflow-hidden rounded-xl border bg-muted/30">
            <MediaImage
              src={coverImageUrl}
              alt={title ? `${title} cover` : "Page cover"}
              className="h-36 w-full object-cover sm:h-44"
            />
            {icon && (
              <span
                aria-hidden="true"
                className="absolute bottom-3 left-5 flex size-11 items-center justify-center rounded-xl border bg-background text-2xl shadow-sm"
              >
                {icon}
              </span>
            )}
          </div>
        )}
        {coverImageError === "invalid" && (
          <p role="status" className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-muted-foreground">
            Cover must be an uploaded image or an http:// or https:// URL.
          </p>
        )}
      </div>
      {pendingDraft && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <p className="text-sm text-muted-foreground">An unsaved local draft is available for this page.</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={recoverLocalDraft}>Recover draft</Button>
            <Button type="button" size="sm" variant="outline" onClick={discardLocalDraft}>Discard draft</Button>
          </div>
        </div>
      )}
      {recoveredDraft && (
        <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground">
          Recovered draft loaded. Saving changes…
        </p>
      )}
      {draftWarning && <p role="status" className="text-xs text-muted-foreground">{draftWarning}</p>}
      {linkSyncWarning && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground"
        >
          {linkSyncWarning}
        </p>
      )}
      <details
        className="group rounded-xl border bg-card"
        onToggle={(event) => {
          if (event.currentTarget.open) void loadRevisions();
        }}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal size={14} aria-hidden="true" />
          <span className="font-medium">Page settings</span>
          <ChevronDown
            size={13}
            aria-hidden="true"
            className="ml-auto transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="space-y-6 border-t p-4">
          <section aria-label="Page appearance" className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Appearance
            </h2>
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
              <Button type="button" variant="outline" size="sm" disabled={coverUploading} onClick={() => void uploadCoverImage()}>
                {coverUploading ? "Uploading…" : "Upload cover"}
              </Button>
              {coverImageUrl && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setCoverImageUrl(""); void savePage({ coverImageUrl: null }); }}>
                  Remove cover
                </Button>
              )}
              <label className="flex w-full min-w-0 flex-1 basis-full items-center gap-2 rounded-md border px-3 py-2 text-sm sm:basis-auto sm:min-w-64">
                <span className="shrink-0 text-muted-foreground">Cover URL</span>
                <input
                  aria-label="Cover image URL"
                  value={coverImageUrl}
                  placeholder="https://… or uploaded file"
                  onChange={(event) => { setCoverImageUrl(event.target.value); setCoverImageError(null); }}
                  onBlur={saveCoverFromInput}
                  className="min-w-0 flex-1 bg-transparent outline-none"
                />
              </label>
            </div>
          </section>

          <section aria-labelledby="page-details-heading" className="space-y-3 border-t pt-6">
            <h2 id="page-details-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Details
            </h2>
            <div className="flex flex-col gap-1.5 min-[360px]:flex-row min-[360px]:items-center min-[360px]:gap-3">
              <label htmlFor="move-page" className="text-sm font-medium shrink-0 whitespace-nowrap">
                Move to
              </label>
              <select
                id="move-page"
                value={parentId ?? ""}
                onChange={(event) => void movePage(event.target.value)}
                disabled={moving}
                className="w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm min-[360px]:w-auto min-[360px]:max-w-full sm:max-w-xs"
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
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={templateSaving}
                onClick={() => void saveAsTemplate()}
              >
                {templateSaving ? "Saving template…" : "Save as template"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Reuse this page’s title, icon, and content as a starting point for new pages.
              </span>
              {templateMessage && (
                <span role="status" className="text-xs text-muted-foreground">
                  {templateMessage}
                </span>
              )}
            </div>
            <PageTags pageId={id} />
            <PageLinks pageId={id} pages={allPages} />
            <RelatedPages pageId={id} />
          </section>

          <section aria-labelledby="page-history-heading" className="space-y-3 border-t pt-6">
            <h2 id="page-history-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              History
            </h2>
            {loadingRevisions && <p role="status" className="text-sm text-muted-foreground">Loading history…</p>}
            {revisionError && <p role="alert" className="text-sm text-destructive">{revisionError}</p>}
            {!loadingRevisions && revisions.length === 0 && !revisionError && (
              <p className="text-sm text-muted-foreground">No saved revisions yet. A snapshot is created when page content changes.</p>
            )}
            {revisions.map((revision) => (
              <article key={revision.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{revision.title || "Untitled"}</p>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{revision.content || "Empty page"}</p>
                  <time className="mt-1 block text-xs text-muted-foreground" dateTime={revision.createdAt}>
                    {new Date(revision.createdAt).toLocaleString()}
                  </time>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={Boolean(restoringRevision)}
                  onClick={() => setRevisionPendingRestore(revision)}
                >
                  {restoringRevision === revision.id ? "Restoring…" : "Restore"}
                </Button>
              </article>
            ))}
          </section>
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
        <div className="sticky top-0 z-30 -mx-4 bg-card px-4 pb-1 pt-3 sm:static sm:mx-0 sm:p-0">
          <EditorToolbar editor={editor} pageId={id} pages={allPages} />
        </div>
        {editor?.isEditable && (
          <DragHandle
            editor={editor}
            className="text-muted-foreground"
            onElementDragStart={(event) => {
              if (!editor) return;
              // Capture the selection before the handle plugin swaps it for the
              // single node it is hovering.
              const group = selectedBlockGroup(editor.state);
              if (!group) return;
              const image = buildBlockDragImage(editor, group.positions);
              if (image) {
                const removeImage = () => image.remove();
                document.addEventListener("dragend", removeImage, { once: true });
                document.addEventListener("drop", removeImage, { once: true });
              }
              queueMicrotask(() => {
                if (group.doc !== editor.state.doc) return;
                // The handle drags one block by default. Hand the drop the whole
                // covered range and move the selection with it, so ProseMirror
                // removes exactly the blocks it inserts.
                editor.view.dragging = { slice: group.slice, move: true };
                editor.view.dispatch(editor.state.tr.setSelection(group.selection));
                if (image && event.dataTransfer) {
                  try {
                    // Replaces the handle's single-block ghost with the group's
                    // blocks. The handle sets its own image later in this same
                    // dragstart, so this has to wait for the next microtask.
                    event.dataTransfer.setDragImage(image, 0, 0);
                  } catch {
                    // A browser that refuses a later drag image still moves the
                    // group; only the ghost stays single-block.
                  }
                }
              });
            }}
          >
            <div
              title="Drag to reorder block (Alt+Shift+↑ / ↓)"
              className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-muted-foreground/70 hover:bg-accent hover:text-foreground active:cursor-grabbing"
            >
              <GripVertical size={16} aria-hidden="true" />
            </div>
          </DragHandle>
        )}
        <div className="border-b py-3">
          <DatabaseEmbedPicker editor={editor} />
        </div>
        {selectedText && !quoteEditing && (
          <figure className="my-3 rounded-r-md border-l-2 border-primary/40 pl-3">
            <blockquote
              aria-label="Quoted passage from the saved link"
              className="text-sm italic text-muted-foreground"
            >
              <p className="whitespace-pre-wrap break-words">{selectedText}</p>
            </blockquote>
            <div className="mt-1 flex items-center gap-1">
              <button
                type="button"
                onClick={() => { setQuoteDraft(selectedText); setQuoteEditing(true); }}
                aria-label="Edit quote"
                title="Edit quote"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Pencil size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => void saveQuote(null)}
                disabled={quoteSaving}
                aria-label="Remove quote"
                title="Remove quote"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          </figure>
        )}
        {selectedText && quoteEditing && (
          <div className="my-3 space-y-2 rounded-r-md border-l-2 border-primary/40 pl-3">
            <label className="sr-only" htmlFor="page-quote">Quoted passage</label>
            <textarea
              id="page-quote"
              autoFocus
              rows={3}
              maxLength={2000}
              value={quoteDraft}
              onChange={(event) => setQuoteDraft(event.target.value)}
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={() => void saveQuote(quoteDraft.trim() || null)} disabled={quoteSaving}>
                {quoteSaving ? "Saving…" : "Save quote"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setQuoteEditing(false)} disabled={quoteSaving}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <EditorContent editor={editor} />
        </div>
        {wikiMenu && (
          <div
            role="listbox"
            aria-label="Link to a page"
            className="fixed z-50 overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
            style={{ left: wikiMenuPlacement?.left, top: wikiMenuPlacement?.top, width: wikiMenuPlacement?.width, maxHeight: wikiMenuPlacement?.maxHeight }}
          >
            {matchingWikiPages.map((page, index) => (
              <button
                key={page.id}
                type="button"
                role="option"
                aria-selected={index === wikiIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setWikiIndex(index)}
                onClick={() => void insertWikiPage(page, wikiMenu)}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left sm:py-2 ${index === wikiIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
              >
                <span className="truncate text-sm font-medium">{page.title || "Untitled"}</span>
                <span className="shrink-0 text-xs text-muted-foreground">Page</span>
              </button>
            ))}
            {canCreateWikiPage && (
              <button
                type="button"
                role="option"
                aria-selected={wikiIndex === matchingWikiPages.length}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setWikiIndex(matchingWikiPages.length)}
                onClick={() => void createWikiPage(wikiMenu)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm sm:py-2 ${wikiIndex === matchingWikiPages.length ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
              >
                <Plus size={15} /> Create page “{wikiMenu.query.trim().slice(0, 80)}”
              </button>
            )}
            {!matchingWikiPages.length && !canCreateWikiPage && <p className="px-3 py-2 text-sm text-muted-foreground">No other pages to link.</p>}
            <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">↑↓ to choose · Enter to insert · Esc to close</p>
          </div>
        )}
        {slashMenu && filteredCommands.length > 0 && (
          <div
            role="listbox"
            aria-label="Insert block"
            className="fixed z-50 overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
            style={{ left: slashMenuPlacement?.left, top: slashMenuPlacement?.top, width: slashMenuPlacement?.width, maxHeight: slashMenuPlacement?.maxHeight }}
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
                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left sm:py-2 ${index === slashIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
              >
                <span className="text-sm font-medium">{command.label}</span>
                <span className="text-xs text-muted-foreground">{command.detail}</span>
              </button>
            ))}
          </div>
        )}
      </div>
        </div>

        <PageRail
          pageId={id}
          headings={headings}
          wordCount={wordCount}
          createdAt={createdAt}
          parentId={parentId}
          parentTitle={
            allPages.find((page) => page.id === parentId)?.title ?? null
          }
          isFavorite={isFavorite}
          onSelectHeading={focusHeading}
        />
      </div>

      <AlertDialog
        open={Boolean(revisionPendingRestore)}
        onOpenChange={(open) => { if (!open) setRevisionPendingRestore(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              “{revisionPendingRestore?.title || "Untitled"}” from{" "}
              {revisionPendingRestore ? new Date(revisionPendingRestore.createdAt).toLocaleString() : "this snapshot"}{" "}
              will replace the current page content. The current page is saved to history first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(restoringRevision)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(restoringRevision)}
              onClick={() => {
                const pending = revisionPendingRestore;
                setRevisionPendingRestore(null);
                if (pending) void restoreRevision(pending.id);
              }}
            >
              Restore version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
