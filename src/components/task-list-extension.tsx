"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";

function TaskItemView({ node, updateAttributes }: NodeViewProps) {
  return (
    <NodeViewWrapper as="li" className="kbs-task-item" data-checked={node.attrs.checked ? "true" : "false"}>
      <input
        type="checkbox"
        checked={Boolean(node.attrs.checked)}
        aria-label={node.attrs.checked ? "Mark task incomplete" : "Mark task complete"}
        onChange={(event) => updateAttributes({ checked: event.currentTarget.checked })}
      />
      <NodeViewContent className="kbs-task-content" />
    </NodeViewWrapper>
  );
}

function CalloutView() {
  return (
    <NodeViewWrapper className="kbs-callout" role="note">
      <span className="kbs-callout-icon" contentEditable={false} aria-hidden="true">✦</span>
      <NodeViewContent className="kbs-callout-content" />
    </NodeViewWrapper>
  );
}

function ToggleView() {
  return (
    <NodeViewWrapper as="details" className="kbs-toggle" open>
      <summary contentEditable={false}>Toggle</summary>
      <div className="kbs-toggle-content"><NodeViewContent /></div>
    </NodeViewWrapper>
  );
}

export const CalloutExtension = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});

export const ToggleExtension = Node.create({
  name: "toggleBlock",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: 'details[data-type="toggleBlock"]', contentElement: "div[data-toggle-content]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["details", mergeAttributes(HTMLAttributes, { "data-type": "toggleBlock" }), ["summary", { contenteditable: "false" }, "Toggle"], ["div", { "data-toggle-content": "" }, 0]];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },
});

export const TaskListExtension = Node.create({
  name: "taskList",
  group: "block",
  content: "taskItem+",
  parseHTML() {
    return [{ tag: 'ul[data-type="taskList"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ul", mergeAttributes(HTMLAttributes, { "data-type": "taskList" }), 0];
  },
});

export const TaskItemExtension = Node.create({
  name: "taskItem",
  content: "paragraph block*",
  defining: true,
  addAttributes() {
    return { checked: { default: false, parseHTML: (element) => element.getAttribute("data-checked") === "true", renderHTML: (attributes) => ({ "data-checked": String(Boolean(attributes.checked)) }) } };
  },
  parseHTML() {
    return [{ tag: 'li[data-type="taskItem"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["li", mergeAttributes(HTMLAttributes, { "data-type": "taskItem" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView);
  },
});
