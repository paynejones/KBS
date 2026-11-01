import { Node, mergeAttributes } from "@tiptap/core";

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
});
