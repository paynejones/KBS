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
