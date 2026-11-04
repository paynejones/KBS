"use client";

import { useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { MediaImage } from "@/components/media-image";
import { isImageMimeType, uploadAttachment } from "@/lib/media";

function ImageEmbedView({ node, updateAttributes, selected }: NodeViewProps) {
  const src = String(node.attrs.src ?? "");
  const [alt, setAlt] = useState(String(node.attrs.alt ?? ""));

  return (
    <NodeViewWrapper className={`my-4 ${selected ? "rounded-lg ring-2 ring-ring" : ""}`} contentEditable={false}>
      {src ? (
        <MediaImage src={src} alt={alt} className="kbs-image-embed" />
      ) : (
        <p role="status" className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
          Missing image source.
        </p>
      )}
      <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        Alt text
        <input
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
          onBlur={() => updateAttributes({ alt: alt.trim() })}
          className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-foreground"
        />
      </label>
    </NodeViewWrapper>
  );
}

export const ImageExtension = Node.create({
  name: "imageEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: "" },
      title: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'img[data-type="imageEmbed"]' }, { tag: "img[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes, { "data-type": "imageEmbed", class: "kbs-image-embed" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageEmbedView);
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste(_view, event) {
            const files = Array.from(event.clipboardData?.files ?? []);
            const images = files.filter((file) => isImageMimeType(file.type));
            if (images.length === 0) return false;
            event.preventDefault();
            void (async () => {
              for (const file of images) {
                try {
                  const uploaded = await uploadAttachment(file);
                  editor.chain().focus().insertContent({
                    type: "imageEmbed",
                    attrs: { src: uploaded.url, alt: "" },
                  }).run();
                } catch {
                  editor.view.dom.dispatchEvent(new CustomEvent("kbs-media-error", {
                    bubbles: true,
                    detail: "Could not upload the pasted image.",
                  }));
                }
              }
            })();
            return true;
          },
          handleDrop(_view, event) {
            const files = Array.from(event.dataTransfer?.files ?? []);
            const images = files.filter((file) => isImageMimeType(file.type));
            if (images.length === 0) return false;
            event.preventDefault();
            void (async () => {
              for (const file of images) {
                try {
                  const uploaded = await uploadAttachment(file);
                  editor.chain().focus().insertContent({
                    type: "imageEmbed",
                    attrs: { src: uploaded.url, alt: "" },
                  }).run();
                } catch {
                  editor.view.dom.dispatchEvent(new CustomEvent("kbs-media-error", {
                    bubbles: true,
                    detail: "Could not upload the dropped image.",
                  }));
                }
              }
            })();
            return true;
          },
        },
      }),
    ];
  },
});
