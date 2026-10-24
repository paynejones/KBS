"use client";

import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";

type EditorToolbarProps = {
  editor: Editor | null;
};

export function EditorToolbar({ editor }: EditorToolbarProps) {
  if (!editor) return null;

  return (
    <div className="flex flex-wrap gap-2 border-b pb-3">
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
  );
}