"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeLinkHref } from "@/lib/link";

type EditorToolbarProps = {
  editor: Editor | null;
};

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkActive, setLinkActive] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkRangeRef = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    if (linkOpen) linkInputRef.current?.focus();
  }, [linkOpen]);

  if (!editor) return null;

  const activeEditor = editor;

  function openLinkPanel() {
    const { from, to } = activeEditor.state.selection;
    linkRangeRef.current = { from, to };
    const isLink = activeEditor.isActive("link");
    setLinkActive(isLink);
    setLinkValue(isLink ? String(activeEditor.getAttributes("link").href ?? "") : "");
    setLinkError("");
    setLinkOpen(true);
  }

  function closeLinkPanel() {
    setLinkOpen(false);
    setLinkError("");
    activeEditor.commands.focus();
  }

  function applyLink() {
    const range = linkRangeRef.current ?? {
      from: activeEditor.state.selection.from,
      to: activeEditor.state.selection.to,
    };
    const href = normalizeLinkHref(linkValue);

    if (!href) {
      setLinkError("Enter a web address, for example https://example.com.");
      return;
    }

    const chain = activeEditor.chain().focus().setTextSelection(range);
    if (range.from === range.to) {
      chain
        .insertContent({ type: "text", text: linkValue.trim(), marks: [{ type: "link", attrs: { href } }] })
        .run();
    } else {
      chain.extendMarkRange("link").setLink({ href }).run();
    }

    setLinkOpen(false);
    setLinkError("");
  }

  function removeLink() {
    activeEditor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkOpen(false);
    setLinkError("");
  }

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="space-y-2 border-b pb-3"
    >
      <div className="flex touch-pan-x flex-nowrap gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible">
        <Button
          variant={editor.isActive("bold") ? "default" : "outline"}
          size="sm"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Bold
        </Button>

        <Button
          variant={editor.isActive("italic") ? "default" : "outline"}
          size="sm"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          Italic
        </Button>

        <Button
          variant={editor.isActive("heading", { level: 1 }) ? "default" : "outline"}
          size="sm"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        >
          H1
        </Button>

        <Button
          variant={editor.isActive("heading", { level: 2 }) ? "default" : "outline"}
          size="sm"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          H2
        </Button>

        <Button
          variant={editor.isActive("bulletList") ? "default" : "outline"}
          size="sm"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          Bullet list
        </Button>

        <Button
          variant={editor.isActive("orderedList") ? "default" : "outline"}
          size="sm"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          Numbered list
        </Button>

        <Button
          variant={editor.isActive("blockquote") ? "default" : "outline"}
          size="sm"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          Quote
        </Button>

        <Button
          variant={linkOpen ? "default" : "outline"}
          size="sm"
          aria-expanded={linkOpen}
          onClick={() => (linkOpen ? closeLinkPanel() : openLinkPanel())}
        >
          <Link2 size={15} /> Link
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
        >
          Undo
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
        >
          Redo
        </Button>
      </div>

      {linkOpen && (
        <div role="group" aria-label="Link" className="flex flex-wrap items-center gap-2">
          <Input
            ref={linkInputRef}
            aria-label="Link URL"
            aria-invalid={Boolean(linkError)}
            value={linkValue}
            placeholder="https://example.com"
            onChange={(event) => {
              setLinkValue(event.target.value);
              setLinkError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                closeLinkPanel();
              }
            }}
            className="h-8 w-full max-w-xs"
          />
          <Button type="button" size="sm" onClick={applyLink}>
            {linkActive ? "Update link" : "Add link"}
          </Button>
          {linkActive && (
            <Button type="button" size="sm" variant="outline" onClick={removeLink}>
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
              Select text to link it, or apply with nothing selected to insert the address.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
