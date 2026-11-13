"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeLinkHref, pageIdFromLinkHref } from "@/lib/link";

export type LinkablePage = { id: string; title: string };

type EditorToolbarProps = {
  editor: Editor | null;
  /** The page being edited, used to record a link to the chosen page. */
  pageId?: string;
  /** Pages offered by the link panel's title search. */
  pages?: LinkablePage[];
};

const PAGE_MATCH_LIMIT = 6;

/** True when text in the document still links to the page, so its connection stays. */
function documentLinksPage(editor: Editor, targetPageId: string): boolean {
  let linked = false;
  editor.state.doc.descendants((node) => {
    if (linked) return false;
    if (node.isText) {
      linked = node.marks.some(
        (mark) =>
          mark.type.name === "link" &&
          pageIdFromLinkHref(mark.attrs.href as string) === targetPageId,
      );
    }
    return !linked;
  });
  return linked;
}

export function EditorToolbar({ editor, pageId, pages = [] }: EditorToolbarProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkActive, setLinkActive] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState("");
  const [linkPageIndex, setLinkPageIndex] = useState(0);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkRangeRef = useRef<{ from: number; to: number } | null>(null);

  const pageMatches = useMemo(() => {
    const query = linkValue.trim();
    if (!query || normalizeLinkHref(query)) return [];
    const needle = query.toLowerCase();
    return pages
      .filter(
        (page) =>
          page.id !== pageId &&
          page.title.trim().length > 0 &&
          page.title.toLowerCase().includes(needle),
      )
      .slice(0, PAGE_MATCH_LIMIT);
  }, [linkValue, pageId, pages]);

  useEffect(() => {
    if (linkOpen) linkInputRef.current?.focus();
  }, [linkOpen]);

  if (!editor) return null;

  const activeEditor = editor;

  function openLinkPanel() {
    const { from, to } = activeEditor.state.selection;
    linkRangeRef.current = { from, to };
    const isLink = activeEditor.isActive("link");
    const href = isLink ? String(activeEditor.getAttributes("link").href ?? "") : "";
    const linkedPage = pages.find((page) => page.id === pageIdFromLinkHref(href));
    setLinkActive(isLink);
    setLinkValue(linkedPage ? linkedPage.title : href);
    setLinkPageIndex(0);
    setLinkError("");
    setLinkOpen(true);
  }

  function closeLinkPanel() {
    setLinkOpen(false);
    setLinkError("");
    activeEditor.commands.focus();
  }

  function linkRange() {
    return linkRangeRef.current ?? {
      from: activeEditor.state.selection.from,
      to: activeEditor.state.selection.to,
    };
  }

  async function deletePageConnection(targetPageId: string) {
    if (!pageId) return;
    const response = await fetch(`/api/pages/${pageId}/links`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPageId, origin: "inline" }),
    });
    if (!response.ok) throw new Error("The page connection could not be removed.");
  }

  /**
   * Drops the recorded connection for a page link that is going away. Returns
   * null when there is nothing to do, so callers stay synchronous in that case.
   * A connection is kept while any other text in the page still links there.
   */
  function staleConnectionRelease(
    previousPageId: string | null,
    nextPageId: string | null,
  ): Promise<void> | null {
    if (!pageId || !previousPageId || previousPageId === nextPageId) return null;
    if (documentLinksPage(activeEditor, previousPageId)) return null;
    return deletePageConnection(previousPageId);
  }

  function connectionError(error: unknown): string {
    return error instanceof Error
      ? error.message
      : "The page connection could not be removed.";
  }

  async function applyLink() {
    const range = linkRange();
    const href = normalizeLinkHref(linkValue);

    if (!href) {
      setLinkError("Enter a web address, for example https://example.com.");
      return;
    }

    const previousPageId = pageIdFromLinkHref(activeEditor.getAttributes("link").href);

    const chain = activeEditor.chain().focus().setTextSelection(range);
    if (range.from === range.to) {
      chain
        .insertContent({ type: "text", text: linkValue.trim(), marks: [{ type: "link", attrs: { href } }] })
        .run();
    } else {
      chain.extendMarkRange("link").setLink({ href }).run();
    }

    const release = staleConnectionRelease(previousPageId, pageIdFromLinkHref(href));
    if (release) {
      try {
        await release;
      } catch (error) {
        setLinkError(connectionError(error));
        return;
      }
    }

    setLinkOpen(false);
    setLinkError("");
  }

  async function applyPageLink(page: LinkablePage) {
    const range = linkRange();
    const href = `/pages/${page.id}`;
    const previousPageId = pageIdFromLinkHref(activeEditor.getAttributes("link").href);
    setLinkError("");

    try {
      if (pageId) {
        const response = await fetch(`/api/pages/${pageId}/links`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetPageId: page.id, origin: "inline" }),
        });
        if (!response.ok) throw new Error("The page link could not be saved.");
      }
    } catch (linkFailure) {
      setLinkError(
        linkFailure instanceof Error ? linkFailure.message : "The page link could not be saved.",
      );
      return;
    }

    const chain = activeEditor.chain().focus().setTextSelection(range);
    if (range.from === range.to) {
      chain
        .insertContent({
          type: "text",
          text: page.title.trim() || "Untitled",
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    } else {
      chain.extendMarkRange("link").setLink({ href }).run();
    }

    const release = staleConnectionRelease(previousPageId, page.id);
    if (release) {
      try {
        await release;
      } catch (error) {
        setLinkError(connectionError(error));
        return;
      }
    }

    setLinkOpen(false);
    setLinkError("");
  }

  function submitLink() {
    if (!normalizeLinkHref(linkValue) && pageMatches.length) {
      void applyPageLink(pageMatches[Math.min(linkPageIndex, pageMatches.length - 1)]);
      return;
    }
    void applyLink();
  }

  async function removeLink() {
    const previousPageId = pageIdFromLinkHref(activeEditor.getAttributes("link").href);
    activeEditor.chain().focus().extendMarkRange("link").unsetLink().run();

    const release = staleConnectionRelease(previousPageId, null);
    if (release) {
      try {
        await release;
      } catch (error) {
        setLinkError(connectionError(error));
        setLinkOpen(true);
        return;
      }
    }

    setLinkOpen(false);
    setLinkError("");
  }

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="space-y-2 border-b pb-3"
    >
      <div className="flex touch-pan-x flex-nowrap items-center gap-1 overflow-x-auto py-1 max-sm:[&_button]:size-9 max-sm:[&_button]:px-0 sm:flex-wrap sm:overflow-visible sm:py-0">
        <Button
          variant={editor.isActive("bold") ? "default" : "outline"}
          size="sm"
          aria-label="Bold"
          aria-pressed={editor.isActive("bold")}
          title="Bold (Ctrl+B)"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={15} aria-hidden="true" />
        </Button>

        <Button
          variant={editor.isActive("italic") ? "default" : "outline"}
          size="sm"
          aria-label="Italic"
          aria-pressed={editor.isActive("italic")}
          title="Italic (Ctrl+I)"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={15} aria-hidden="true" />
        </Button>

        <Button
          variant={editor.isActive("heading", { level: 1 }) ? "default" : "outline"}
          size="sm"
          aria-label="Heading 1"
          aria-pressed={editor.isActive("heading", { level: 1 })}
          title="Heading 1"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        >
          <Heading1 size={15} aria-hidden="true" />
        </Button>

        <Button
          variant={editor.isActive("heading", { level: 2 }) ? "default" : "outline"}
          size="sm"
          aria-label="Heading 2"
          aria-pressed={editor.isActive("heading", { level: 2 })}
          title="Heading 2"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          <Heading2 size={15} aria-hidden="true" />
        </Button>

        <Button
          variant={editor.isActive("bulletList") ? "default" : "outline"}
          size="sm"
          aria-label="Bullet list"
          aria-pressed={editor.isActive("bulletList")}
          title="Bullet list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={15} aria-hidden="true" />
        </Button>

        <Button
          variant={editor.isActive("orderedList") ? "default" : "outline"}
          size="sm"
          aria-label="Numbered list"
          aria-pressed={editor.isActive("orderedList")}
          title="Numbered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={15} aria-hidden="true" />
        </Button>

        <Button
          variant={editor.isActive("blockquote") ? "default" : "outline"}
          size="sm"
          aria-label="Quote"
          aria-pressed={editor.isActive("blockquote")}
          title="Quote"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={15} aria-hidden="true" />
        </Button>

        <Button
          variant={linkOpen ? "default" : "outline"}
          size="sm"
          aria-label="Link"
          aria-expanded={linkOpen}
          title="Link to a page or web address"
          onClick={() => (linkOpen ? closeLinkPanel() : openLinkPanel())}
        >
          <Link2 size={15} aria-hidden="true" />
        </Button>

        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 self-center bg-border" />

        <Button
          variant="outline"
          size="sm"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
        >
          <Undo2 size={15} aria-hidden="true" />
        </Button>

        <Button
          variant="outline"
          size="sm"
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
        >
          <Redo2 size={15} aria-hidden="true" />
        </Button>
      </div>

      {linkOpen && (
        <div role="group" aria-label="Link" className="flex flex-wrap items-center gap-2 max-sm:[&_button]:h-9 max-sm:[&_button]:px-3 max-sm:[&_button]:text-sm">
          <div className="w-full max-w-xs space-y-1">
            <Input
              ref={linkInputRef}
              aria-label="Link target"
              aria-invalid={Boolean(linkError)}
              aria-autocomplete={pageMatches.length ? "list" : undefined}
              value={linkValue}
              placeholder="https://example.com or page title"
              onChange={(event) => {
                setLinkValue(event.target.value);
                setLinkPageIndex(0);
                setLinkError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && pageMatches.length) {
                  event.preventDefault();
                  setLinkPageIndex((index) => (index + 1) % pageMatches.length);
                  return;
                }
                if (event.key === "ArrowUp" && pageMatches.length) {
                  event.preventDefault();
                  setLinkPageIndex(
                    (index) => (index - 1 + pageMatches.length) % pageMatches.length,
                  );
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitLink();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeLinkPanel();
                }
              }}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              className="h-10 w-full sm:h-8"
            />
            {pageMatches.length > 0 && (
              <div
                role="listbox"
                aria-label="Link to a page"
                className="overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-popover-foreground shadow-sm"
              >
                {pageMatches.map((page, index) => (
                  <button
                    key={page.id}
                    type="button"
                    role="option"
                    aria-selected={index === linkPageIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setLinkPageIndex(index)}
                    onClick={() => void applyPageLink(page)}
                    className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left sm:py-1.5 ${index === linkPageIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
                  >
                    <span className="truncate text-sm font-medium">{page.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">Page</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button type="button" size="sm" onClick={submitLink}>
            {linkActive ? "Update link" : "Add link"}
          </Button>
          {linkActive && (
            <Button type="button" size="sm" variant="outline" onClick={() => void removeLink()}>
              Remove link
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={closeLinkPanel}>
            Cancel
          </Button>
          {linkError ? (
            <p role="alert" className="text-xs text-destructive">
              {linkError}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {pageMatches.length
                ? "Pick a page below, or use a web address."
                : "Select text to link it, or apply with nothing selected to insert the address."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
