type InlineNode = { type: "text"; text: string };
type BlockNode = { type: string; attrs?: Record<string, unknown>; content?: unknown[] };

const text = (value: string): InlineNode => ({ type: "text", text: value });
const paragraph = (...children: InlineNode[]): BlockNode => ({
  type: "paragraph",
  ...(children.length > 0 ? { content: children } : {}),
});
const heading = (level: number, value: string): BlockNode => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const bulletList = (items: string[]): BlockNode => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [paragraph(text(item))] })),
});
const taskList = (items: string[]): BlockNode => ({
  type: "taskList",
  content: items.map((item) => ({
    type: "taskItem",
    attrs: { checked: false },
    content: [paragraph(text(item))],
  })),
});

/** Flattens a Tiptap document to plain text for page search and previews. */
export function documentText(node: unknown): string {
  if (Array.isArray(node)) return node.map(documentText).filter(Boolean).join(" ");
  if (!node || typeof node !== "object") return "";

  const record = node as { text?: unknown; content?: unknown };
  if (typeof record.text === "string") return record.text;
  return documentText(record.content).trim();
}

const starterDocuments: { name: string; title: string; icon: string; content: BlockNode[] }[] = [
  {
    name: "Decision journal",
    title: "Decision journal",
    icon: "🧭",
    content: [
      paragraph(text("Record a decision while the reasoning is still fresh.")),
      heading(2, "Decision"),
      paragraph(),
      heading(2, "Context"),
      paragraph(),
      heading(2, "Options considered"),
      bulletList(["Option one: ", "Option two: "]),
      heading(2, "Why this one"),
      paragraph(),
      heading(2, "Expected outcome"),
      paragraph(),
      heading(2, "Review date"),
      paragraph(),
    ],
  },
  {
    name: "Project kickoff",
    title: "Project kickoff",
    icon: "🚀",
    content: [
      paragraph(text("Set a project up so its goal, scope, and next steps are clear.")),
      heading(2, "Goal"),
      paragraph(),
      heading(2, "Scope"),
      bulletList(["In scope: ", "Out of scope: "]),
      heading(2, "Milestones"),
      taskList(["Define the first milestone", "Collect reference material", "Schedule a review"]),
      heading(2, "Risks"),
      bulletList(["Risk: "]),
      heading(2, "Related pages"),
      paragraph(),
    ],
  },
];

/**
 * Templates offered when a workspace has none yet, so the first recurring
 * structure can be created without writing one by hand.
 */
export function starterPageTemplates() {
  return starterDocuments.map((template) => {
    const contentJson: Record<string, unknown> = { type: "doc", content: template.content };
    return {
      name: template.name,
      title: template.title,
      icon: template.icon,
      contentJson,
      content: documentText(contentJson),
    };
  });
}
