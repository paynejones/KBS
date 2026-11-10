export type GraphNode = { id: string; title: string; isFavorite: boolean };
export type GraphEdge = { source: string; target: string; type: "link" | "hierarchy" };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

export type GraphFilters = {
  /** Show explicit page links between pages. */
  links: boolean;
  /** Show parent/child structure. */
  hierarchy: boolean;
  /** Keep only favorite pages. */
  favoritesOnly: boolean;
};

export const DEFAULT_GRAPH_FILTERS: GraphFilters = {
  links: true,
  hierarchy: true,
  favoritesOnly: false,
};

/**
 * Applies the graph's display filters. Edges are dropped when their type is
 * hidden or when either endpoint was filtered out, so the graph never shows a
 * line to a page that is no longer drawn.
 */
export function filterGraph(data: GraphData, filters: GraphFilters): GraphData {
  const nodes = filters.favoritesOnly
    ? data.nodes.filter((node) => node.isFavorite)
    : data.nodes;
  const ids = new Set(nodes.map((node) => node.id));

  const edges = data.edges.filter((edge) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return false;
    return edge.type === "link" ? filters.links : filters.hierarchy;
  });

  return { nodes, edges };
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
