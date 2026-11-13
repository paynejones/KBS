import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GRAPH_FILTERS,
  filterGraph,
  graphListItems,
  pageGroupIds,
  type GraphData,
} from "../src/lib/graph";

const work = { id: "tag-work", name: "Work" };
const reading = { id: "tag-reading", name: "Reading" };

const data: GraphData = {
  nodes: [
    { id: "a", title: "Beta", isFavorite: false, parentId: null, tags: [work] },
    { id: "b", title: "Alpha", isFavorite: true, parentId: null, tags: [work, reading] },
    { id: "c", title: "Gamma", isFavorite: false, parentId: "a", tags: [reading] },
    { id: "d", title: "Delta", isFavorite: false, parentId: "c", tags: [] },
    { id: "e", title: "Epsilon", isFavorite: false, parentId: null, tags: [work] },
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

test("a tag filter keeps only pages carrying that tag", () => {
  const filtered = filterGraph(data, { ...DEFAULT_GRAPH_FILTERS, tagId: reading.id });
  assert.deepEqual(filtered.nodes.map((node) => node.id), ["b", "c"]);
  assert.deepEqual(filtered.edges, [data.edges[1]], "edges to untagged pages are dropped");
});

test("a page group keeps the chosen page and its descendants", () => {
  assert.deepEqual([...pageGroupIds(data.nodes, "a")].sort(), ["a", "c", "d"]);

  const filtered = filterGraph(data, { ...DEFAULT_GRAPH_FILTERS, groupRootId: "a" });
  assert.deepEqual(filtered.nodes.map((node) => node.id), ["a", "c", "d"]);
  assert.deepEqual(filtered.edges, [], "edges crossing the group boundary are dropped");
});

test("a page group ignores a missing root and repeated ancestry", () => {
  assert.equal(pageGroupIds(data.nodes, "missing").size, 0);
  assert.deepEqual(
    [...pageGroupIds([
      { id: "loop-a", parentId: "loop-b" },
      { id: "loop-b", parentId: "loop-a" },
    ], "loop-a")].sort(),
    ["loop-a", "loop-b"],
  );
});

test("shared tags connect pages that share one, once per pair", () => {
  const filtered = filterGraph(data, { ...DEFAULT_GRAPH_FILTERS, sharedTags: true });

  assert.deepEqual(filtered.edges, [
    ...data.edges,
    // b and c share a tag, but their hierarchy edge already draws that pair.
    { source: "a", target: "e", type: "tag" },
    { source: "b", target: "e", type: "tag" },
  ]);
});

test("shared tags fall back to an existing relation when its type is hidden", () => {
  const filtered = filterGraph(data, { ...DEFAULT_GRAPH_FILTERS, links: false, sharedTags: true });

  assert.deepEqual(filtered.edges, [
    data.edges[1],
    { source: "a", target: "b", type: "tag" },
    { source: "a", target: "e", type: "tag" },
    { source: "b", target: "e", type: "tag" },
  ]);
});

test("shared tags respect the other filters", () => {
  const filtered = filterGraph(data, { ...DEFAULT_GRAPH_FILTERS, sharedTags: true, tagId: work.id });

  assert.deepEqual(filtered.nodes.map((node) => node.id), ["a", "b", "e"]);
  assert.deepEqual(filtered.edges, [
    data.edges[0],
    { source: "a", target: "e", type: "tag" },
    { source: "b", target: "e", type: "tag" },
  ]);
});

test("turning shared tags off drops tag edges from already-filtered data", () => {
  const withTags = filterGraph(data, { ...DEFAULT_GRAPH_FILTERS, sharedTags: true });
  const without = filterGraph(withTags, { ...DEFAULT_GRAPH_FILTERS, sharedTags: false });

  assert.deepEqual(without.edges, data.edges);
});

test("the small-screen list puts favorites first and then sorts by title", () => {
  assert.deepEqual(graphListItems(data.nodes).map((node) => node.id), ["b", "a", "d", "e", "c"]);
});

test("database pages stay hidden until the filter is on", () => {
  const withRecordPage: GraphData = {
    nodes: [
      ...data.nodes,
      { id: "r", title: "Record page", isFavorite: false, parentId: null, tags: [work], isRecordPage: true },
    ],
    edges: [...data.edges, { source: "a", target: "r", type: "hierarchy" }],
  };

  const hidden = filterGraph(withRecordPage, DEFAULT_GRAPH_FILTERS);
  assert.deepEqual(hidden.nodes.map((node) => node.id), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(hidden.edges, data.edges, "edges to a hidden record page are dropped");

  const shown = filterGraph(withRecordPage, { ...DEFAULT_GRAPH_FILTERS, databasePages: true });
  assert.deepEqual(shown.nodes.map((node) => node.id), ["a", "b", "c", "d", "e", "r"]);
  assert.deepEqual(shown.edges, withRecordPage.edges);
});
