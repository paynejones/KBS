type JSONNode = {
  type?: string;
  text?: string;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: JSONNode[];
};

const SNIPPET_LIMIT = 180;
const CONTEXT_LIMIT = 3;
const LEAD_CONTEXT = 70;

/**
 * True when a link target points at the given page. Inline page links are
 * stored as `<a href="/pages/<id>">`, but an absolute URL with the same path
 * should count too.
 */
export function linkHrefTargetsPage(href: unknown, pageId: string): boolean {
  if (typeof href !== "string" || !href.trim()) return false;
  let pathname: string;
  try {
    pathname = new URL(href, "http://kbs.local").pathname;
  } catch {
    return false;
  }
  return pathname.replace(/\/+$/, "") === `/pages/${pageId}`;
}

function hasPageLink(node: JSONNode, pageId: string): boolean {
  return (node.marks ?? []).some(
    (mark) => mark.type === "link" && linkHrefTargetsPage(mark.attrs?.href, pageId),
  );
}

function inlineContent(
  node: JSONNode,
  pageId: string,
): { text: string; matchOffset: number | null } {
  let text = "";
  let matchOffset: number | null = null;

  for (const child of node.content ?? []) {
    if (typeof child.text === "string") {
      if (matchOffset === null && hasPageLink(child, pageId)) {
        matchOffset = text.length;
      }
      text += child.text;
      continue;
    }

    if (child.type === "hardBreak") {
      text += " ";
      continue;
    }

    if (child.content) {
      const nested = inlineContent(child, pageId);
      if (matchOffset === null && nested.matchOffset !== null) {
        matchOffset = text.length + nested.matchOffset;
      }
      text += nested.text;
    }
  }

  return { text, matchOffset };
}

function snippetAt(text: string, offset: number): string {
  const start = Math.max(0, offset - LEAD_CONTEXT);
  const end = Math.min(text.length, start + SNIPPET_LIMIT);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

function walk(node: JSONNode, pageId: string, snippets: string[], limit: number) {
  if (snippets.length >= limit) return;

  const isBlock = (node.content ?? []).some(
    (child) => typeof child.text === "string" || child.type === "hardBreak",
  );

  if (isBlock) {
    const { text, matchOffset } = inlineContent(node, pageId);
    if (matchOffset !== null && text.trim()) {
      const snippet = snippetAt(text, matchOffset);
      if (!snippets.includes(snippet)) snippets.push(snippet);
    }
  }

  for (const child of node.content ?? []) {
    if (snippets.length >= limit) return;
    walk(child, pageId, snippets, limit);
  }
}

/**
 * Text snippets from a page's stored editor content that show where it links
 * to `pageId`. Works on TiPTap JSON, so links added from the connections panel
 * (which have no content) simply have no context.
 */
export function backlinkContexts(
  contentJson: unknown,
  pageId: string,
  limit = CONTEXT_LIMIT,
): string[] {
  if (!contentJson || typeof contentJson !== "object") return [];
  const snippets: string[] = [];
  walk(contentJson as JSONNode, pageId, snippets, limit);
  return snippets;
}
