type TiptapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: TiptapNode[];
};

function renderInline(node: TiptapNode): string {
  if (node.type === "hardBreak") return "  \n";
  if (node.type === "databaseEmbed") {
    const id = String(node.attrs?.databaseId ?? "");
    return `\n> Embedded database: ${id}\n`;
  }
  let text = node.text ?? (node.content ?? []).map(renderInline).join("");
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") text = `**${text}**`;
    if (mark.type === "italic") text = `_${text}_`;
    if (mark.type === "strike") text = `~~${text}~~`;
    if (mark.type === "code") text = `\`${text}\``;
    if (mark.type === "link") {
      const href = String(mark.attrs?.href ?? "").replace(/[()\s]/g, (char) => encodeURIComponent(char));
      text = `[${text}](${href})`;
    }
  }
  return text;
}

function renderList(node: TiptapNode, ordered: boolean): string {
  const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
  return (node.content ?? []).map((item, index) => {
    const marker = ordered ? `${start + index}. ` : "- ";
    const lines = (item.content ?? []).map((child) => {
      if (child.type === "paragraph") return (child.content ?? []).map(renderInline).join("");
      if (child.type === "bulletList" || child.type === "orderedList") return renderList(child, child.type === "orderedList").trimEnd();
      return renderBlock(child).trim();
    }).filter(Boolean);
    return `${marker}${lines.join("\n  ").replace(/\n/g, "\n  ")}`;
  }).join("\n") + "\n\n";
}

function renderBlock(node: TiptapNode): string {
  switch (node.type) {
    case "paragraph":
      return `${(node.content ?? []).map(renderInline).join("")}\n\n`;
    case "heading": {
      const level = Math.max(1, Math.min(6, Number(node.attrs?.level ?? 1)));
      return `${"#".repeat(level)} ${(node.content ?? []).map(renderInline).join("")}\n\n`;
    }
    case "bulletList":
      return renderList(node, false);
    case "orderedList":
      return renderList(node, true);
    case "blockquote":
      return (node.content ?? []).map(renderBlock).join("").trimEnd().split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      return `\`\`\`${language}\n${(node.content ?? []).map(renderInline).join("")}\n\`\`\`\n\n`;
    }
    case "horizontalRule":
      return "---\n\n";
    case "databaseEmbed":
      return renderInline(node) + "\n";
    default:
      return (node.content ?? []).map(renderBlock).join("");
  }
}

export function tiptapToMarkdown(document: Record<string, unknown>) {
  const root = document as TiptapNode;
  return (root.content ?? []).map(renderBlock).join("").trimEnd();
}
