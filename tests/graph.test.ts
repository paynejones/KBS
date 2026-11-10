import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GRAPH_FILTERS,
  filterGraph,
  graphListItems,
  type GraphData,
} from "../src/lib/graph";

const data: GraphData = {
  nodes: [
    { id: "a", title: "Beta", isFavorite: false },
    { id: "b", title: "Alpha", isFavorite: true },
    { id: "c", title: "Gamma", isFavorite: false },
  ],
  edges: [
    { source: "a", target: "b", type: "link" },
    { source: "b", target: "c", type: "hierarchy" },
  ],
};

test("defaults keep every node and edge", () => {
  assert.deepEqual(filterGraph(data, DEFAULT_GRAPH_FILTERS), data);
});

test("hiding an edge type removes only those edges", () => {
  const linksOnly = filterGraph(data, { ...DEFAULT_GRAPH_FILTERS, hierarchy: false });
  assert.deepEqual(linksOnly.edges, [data.edges[0]]);

  const hierarchyOnly = filterGraph(data, { ...DEFAULT_GRAPH_FILTERS, links: false });
  assert.deepEqual(hierarchyOnly.edges, [data.edges[1]]);
});

test("favorites only keeps favorites and drops edges to hidden pages", () => {
  const filtered = filterGraph(data, { ...DEFAULT_GRAPH_FILTERS, favoritesOnly: true });
  assert.deepEqual(filtered.nodes.map((node) => node.id), ["b"]);
  assert.deepEqual(filtered.edges, []);
});

test("the small-screen list puts favorites first and then sorts by title", () => {
  assert.deepEqual(graphListItems(data.nodes).map((node) => node.id), ["b", "a", "c"]);
});
