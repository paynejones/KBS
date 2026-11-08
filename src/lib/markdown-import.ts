type InlineNode = { type: string; text?: string; marks?: { type: string; attrs?: Record<string, string> }[] };
type BlockNode = { type: string; attrs?: Record<string, unknown>; content?: unknown[] };

function inlineContent(value: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  // Inline images cannot sit inside a paragraph, so they keep their alt text.
  value = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  const tokens = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\*([^*]+)\*|_([^_]+)_/g;
  let cursor = 0;
  for (const match of value.matchAll(tokens)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push({ type: "text", text: value.slice(cursor, index) });
    if (match[1] !== undefined) {
      nodes.push({ type: "text", text: match[1], marks: [{ type: "link", attrs: { href: match[2] } }] });
    } else if (match[3] !== undefined) {
      nodes.push({ type: "text", text: match[3], marks: [{ type: "bold" }] });
    } else if (match[4] !== undefined) {
      nodes.push({ type: "text", text: match[4], marks: [{ type: "strike" }] });
    } else if (match[5] !== undefined) {
      nodes.push({ type: "text", text: match[5], marks: [{ type: "code" }] });
    } else if (match[6] !== undefined) {
      nodes.push({ type: "text", text: match[6], marks: [{ type: "italic" }] });
    } else if (match[7] !== undefined) {
      nodes.push({ type: "text", text: match[7], marks: [{ type: "italic" }] });
    }
    cursor = index + match[0].length;
  }
  if (cursor < value.length) nodes.push({ type: "text", text: value.slice(cursor) });
  return nodes;
}

function isImageTarget(src: string) {
  if (/^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith("data:")) return true;
  return /\.(png|jpe?g|gif|webp|avif)(?:[?#].*)?$/i.test(src);
}

function isBlockStart(line: string) {
  return /^(#{1,6})\s|^```|^\s*([-*+]\s|\d+[.)]\s)|^>\s?|^\s*([-*_]\s*){3,}$/.test(line);
}

function parseBlocks(markdown: string): BlockNode[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }

    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      index++;
      const code: string[] = [];
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push({ type: "codeBlock", attrs: { language: fence[1] || null }, content: code.length ? [{ type: "text", text: code.join("\n") }] : [] });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "heading", attrs: { level: heading[1].length }, content: inlineContent(heading[2]) });
      index++;
      continue;
    }

    if (/^\s*([-*_]\s*){3,}$/.test(line)) {
      blocks.push({ type: "horizontalRule" });
      index++;
      continue;
    }

    const image = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/);
    if (image) {
      const src = image[2];
      if (isImageTarget(src)) {
        blocks.push({ type: "imageEmbed", attrs: { src, alt: image[1] } });
      } else {
        // Image syntax can point at any file. A non-image becomes a link so an
        // imported note lists the attachment instead of showing a broken image.
        const label = image[1].trim() || src.split("/").pop() || src;
        blocks.push({
          type: "paragraph",
          content: [{ type: "text", text: label, marks: [{ type: "link", attrs: { href: src } }] }],
        });
      }
      index++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quoteLines.push(lines[index++].replace(/^>\s?/, ""));
      blocks.push({ type: "blockquote", content: [{ type: "paragraph", content: inlineContent(quoteLines.join(" ")) }] });
      continue;
    }

    const listMatch = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const listItems: BlockNode[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        listItems.push({ type: "listItem", content: [{ type: "paragraph", content: inlineContent(item[3]) }] });
        index++;
      }
      blocks.push({ type: ordered ? "orderedList" : "bulletList", content: listItems });
      continue;
    }

    const paragraph: string[] = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) paragraph.push(lines[index++]);
    blocks.push({ type: "paragraph", content: inlineContent(paragraph.join(" ")) });
  }
  return blocks;
}

function getPlainText(nodes: BlockNode[]): string {
  return nodes.map((node) => {
    if (node.type === "horizontalRule") return "";
    const childNodes = (node.content ?? []) as (BlockNode & { text?: string })[];
    if (node.type === "bulletList" || node.type === "orderedList") {
      return childNodes.map((child) => getPlainText([child])).join("\n");
    }
    return childNodes.map((child) => child.text ?? getPlainText([child])).join("");
  }).filter(Boolean).join("\n");
}

export function markdownFileToPage(markdown: string, filename: string) {
  const title = filename.replace(/\.(md|markdown)$/i, "").replace(/\s+[0-9a-f]{8,}$/i, "").replace(/[_-]+/g, " ").trim() || "Imported page";
  let body = markdown.replace(/\r\n?/g, "\n");
  const firstHeading = body.match(/^#\s+(.+)\s*(?:\n|$)/);
  if (firstHeading && firstHeading[1].trim().toLocaleLowerCase() === title.toLocaleLowerCase()) {
    body = body.slice(firstHeading[0].length);
  }
  const content = parseBlocks(body);
  const contentJson = { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
  return { title, content: getPlainText(content), contentJson };
}
