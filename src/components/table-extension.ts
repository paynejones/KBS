import { Node, mergeAttributes } from "@tiptap/core";

export const TableExtension = Node.create({
  name: "table",
  group: "block",
  content: "tableRow+",
  isolating: true,
  parseHTML() {
    return [{ tag: "table" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["table", mergeAttributes(HTMLAttributes, { class: "kbs-table" }), ["tbody", 0]];
  },
});

export const TableRowExtension = Node.create({
  name: "tableRow",
  content: "(tableHeader | tableCell)+",
  parseHTML() {
    return [{ tag: "tr" }];
  },
  renderHTML() {
    return ["tr", 0];
  },
});

export const TableHeaderExtension = Node.create({
  name: "tableHeader",
  content: "block+",
  isolating: true,
  parseHTML() {
    return [{ tag: "th" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["th", mergeAttributes(HTMLAttributes, { scope: "col" }), 0];
  },
});

export const TableCellExtension = Node.create({
  name: "tableCell",
  content: "block+",
  isolating: true,
  parseHTML() {
    return [{ tag: "td" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["td", HTMLAttributes, 0];
  },
});
