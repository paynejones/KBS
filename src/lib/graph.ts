export type GraphTag = { id: string; name: string };

export type GraphNode = {
  id: string;
  title: string;
  isFavorite: boolean;
  parentId: string | null;
  tags: GraphTag[];
};

export type GraphEdgeType = "link" | "hierarchy" | "tag";
export type GraphEdge = { source: string; target: string; type: GraphEdgeType };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

export type GraphFilters = {
  /** Show explicit page links between pages. */
  links: boolean;
  /** Show parent/child structure. */
  hierarchy: boolean;
  /** Keep only favorite pages. */
  favoritesOnly: boolean;
  /** Keep only pages carrying this tag; empty shows every tag. */
  tagId: string;
  /** Keep one page and every page beneath it; empty shows the whole workspace. */
  groupRootId: string;
  /** Draw a line between pages that share a tag but no visible relation. */
  sharedTags: boolean;
};

export const DEFAULT_GRAPH_FILTERS: GraphFilters = {
  links: true,
  hierarchy: true,
  favoritesOnly: false,
  tagId: "",
  groupRootId: "",
  sharedTags: false,
};

function pairKey(source: string, target: string) {
  return source < target ? `${source}|${target}` : `${target}|${source}`;
}

/**
 * Collects a page and everything beneath it. A page that is missing from the
 * node list (filtered out, trashed, or a stale parent) simply contributes
 * nothing, and repeated ancestry cannot loop forever.
 */
export function pageGroupIds(
  nodes: readonly Pick<GraphNode, "id" | "parentId">[],
  rootId: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  }

  const ids = new Set<string>();
  if (!nodes.some((node) => node.id === rootId)) return ids;

  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (ids.has(id)) continue;
    ids.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return ids;
}

/**
 * Pairs pages that share a tag, once per pair even when they share several.
 * Pairs that already show a line keep only that line, so tag edges reveal
 * implicit connections instead of doubling the visible ones.
 */
function sharedTagEdges(nodes: readonly GraphNode[], connected: ReadonlySet<string>): GraphEdge[] {
  const pagesByTag = new Map<string, string[]>();
  for (const node of nodes) {
    for (const tag of node.tags) {
      pagesByTag.set(tag.id, [...(pagesByTag.get(tag.id) ?? []), node.id]);
    }
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const pageIds of pagesByTag.values()) {
    for (let index = 0; index < pageIds.length; index += 1) {
      for (let other = index + 1; other < pageIds.length; other += 1) {
        const source = pageIds[index];
        const target = pageIds[other];
        const key = pairKey(source, target);
        if (connected.has(key) || seen.has(key)) continue;
        seen.add(key);
        edges.push({ source, target, type: "tag" });
      }
    }
  }
  return edges;
}

/**
 * Applies the graph's display filters. Edges are dropped when their type is
 * hidden or when either endpoint was filtered out, so the graph never shows a
 * line to a page that is no longer drawn.
 */
export function filterGraph(data: GraphData, filters: GraphFilters): GraphData {
  let nodes = data.nodes;

  if (filters.groupRootId) {
    const groupIds = pageGroupIds(nodes, filters.groupRootId);
    nodes = nodes.filter((node) => groupIds.has(node.id));
  }
  if (filters.tagId) {
    nodes = nodes.filter((node) => node.tags.some((tag) => tag.id === filters.tagId));
  }
  if (filters.favoritesOnly) {
    nodes = nodes.filter((node) => node.isFavorite);
  }

  const ids = new Set(nodes.map((node) => node.id));
  const edges = data.edges.filter((edge) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return false;
    if (edge.type === "link") return filters.links;
    if (edge.type === "hierarchy") return filters.hierarchy;
    return filters.sharedTags;
  });

  if (!filters.sharedTags) return { nodes, edges };

  const connected = new Set(edges.map((edge) => pairKey(edge.source, edge.target)));
  return { nodes, edges: [...edges, ...sharedTagEdges(nodes, connected)] };
}

/** The small-screen list keeps favorites first, then alphabetical order. */
export function graphListItems(nodes: readonly GraphNode[]): GraphNode[] {
  return [...nodes].sort(
    (left, right) =>
      Number(right.isFavorite) - Number(left.isFavorite) ||
      (left.title || "Untitled").localeCompare(right.title || "Untitled", undefined, {
        sensitivity: "base",
      }),
  );
}
