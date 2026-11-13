"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Link2, Minus, Plus, Search, Star } from "lucide-react";
import {
  DEFAULT_GRAPH_FILTERS,
  filterGraph,
  graphListItems,
  type GraphEdge,
  type GraphFilters,
  type GraphNode,
  type GraphData,
} from "@/lib/graph";
import {
  getNavigationSnapshot,
  getServerNavigationSnapshot,
  subscribeToNavigation,
} from "@/lib/navigation";

type Point = { x: number; y: number };

// Fixed, theme-independent hues: tag strokes and fills need to stay
// recognisable in every palette, including the tinted ones.
const TAG_PALETTE = [
  "#6366f1",
  "#0d9488",
  "#d97706",
  "#e11d48",
  "#7c3aed",
  "#0284c7",
  "#65a30d",
  "#c026d3",
];

/** `zoom` above this shows every title; below it titles wait for hover. */
const LABEL_ZOOM = 1.3;
const LABEL_MAX_CHARS = 28;

type LabelAnchor = "middle" | "start" | "end";
type LabelPlacement = { x: number; y: number; anchor: LabelAnchor; text: string };
type Box = { left: number; right: number; top: number; bottom: number };
type Circle = { x: number; y: number; radius: number };

function nodeRadiusFor(degree: number) {
  return Math.min(21, 10 + Math.sqrt(degree) * 3.2);
}

/** Long titles are clamped so a single page cannot claim half the canvas. */
function truncateLabel(title: string, max = LABEL_MAX_CHARS) {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function labelBox(x: number, y: number, width: number, anchor: LabelAnchor): Box {
  const left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
  return { left, right: left + width, top: y - 13, bottom: y + 5 };
}

function boxesOverlap(left: Box, right: Box) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

/** Rectangle-to-circle check, so a title never lands on top of a node. */
function boxHitsCircle(box: Box, circle: Circle) {
  const closestX = clamp(circle.x, box.left, box.right);
  const closestY = clamp(circle.y, box.top, box.bottom);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy < circle.radius * circle.radius;
}

function edgePath(
  source: Point,
  target: Point,
  sourceInset: number,
  targetInset: number,
  bend: number,
) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const start = {
    x: source.x + (dx / length) * Math.min(sourceInset, length / 2),
    y: source.y + (dy / length) * Math.min(sourceInset, length / 2),
  };
  const end = {
    x: target.x - (dx / length) * Math.min(targetInset, length / 2),
    y: target.y - (dy / length) * Math.min(targetInset, length / 2),
  };
  // A gentle bow keeps overlapping relations separable without pulling the
  // endpoints off their nodes.
  const control = {
    x: (start.x + end.x) / 2 - (dy / length) * length * bend,
    y: (start.y + end.y) / 2 + (dx / length) * length * bend,
  };
  return {
    d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
    mid: {
      x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
      y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
    },
  };
}

function edgeKey(edge: GraphEdge, index: number) {
  return `${edge.type}-${edge.source}-${edge.target}-${index}`;
}

function neighborhoodIds(data: GraphData, focusId: string, depth: number) {
  const adjacent = new Map<string, string[]>();
  for (const edge of data.edges) {
    adjacent.set(edge.source, [...(adjacent.get(edge.source) ?? []), edge.target]);
    adjacent.set(edge.target, [...(adjacent.get(edge.target) ?? []), edge.source]);
  }
  const found = new Set([focusId]);
  let frontier = [focusId];
  for (let level = 0; level < depth; level += 1) {
    frontier = frontier.flatMap((id) => adjacent.get(id) ?? []).filter((id) => {
      if (found.has(id)) return false;
      found.add(id);
      return true;
    });
  }
  return found;
}

function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]) {
  const points = new Map<string, Point>();
  const velocities = new Map<string, Point>();
  const angleStep = Math.PI * (3 - Math.sqrt(5));
  nodes.forEach((node, index) => {
    const angle = index * angleStep;
    const radius = 45 + Math.sqrt(index + 1) * 22;
    points.set(node.id, { x: 500 + Math.cos(angle) * radius, y: 350 + Math.sin(angle) * radius });
    velocities.set(node.id, { x: 0, y: 0 });
  });

  if (nodes.length <= 250) {
    for (let iteration = 0; iteration < 110; iteration += 1) {
      const forces = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        const pa = points.get(a.id)!;
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          const pb = points.get(b.id)!;
          const dx = pa.x - pb.x || 0.1;
          const dy = pa.y - pb.y || 0.1;
          const distanceSquared = dx * dx + dy * dy;
          const force = Math.min(18, 7800 / distanceSquared);
          const fx = (dx / Math.sqrt(distanceSquared)) * force;
          const fy = (dy / Math.sqrt(distanceSquared)) * force;
          forces.get(a.id)!.x += fx;
          forces.get(a.id)!.y += fy;
          forces.get(b.id)!.x -= fx;
          forces.get(b.id)!.y -= fy;
        }
      }

      for (const edge of edges) {
        const a = points.get(edge.source);
        const b = points.get(edge.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const force = (distance - 125) * 0.012;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        forces.get(edge.source)!.x += fx;
        forces.get(edge.source)!.y += fy;
        forces.get(edge.target)!.x -= fx;
        forces.get(edge.target)!.y -= fy;
      }

      for (const node of nodes) {
        const point = points.get(node.id)!;
        const velocity = velocities.get(node.id)!;
        const force = forces.get(node.id)!;
        velocity.x = (velocity.x + force.x - (point.x - 500) * 0.0015) * 0.78;
        velocity.y = (velocity.y + force.y - (point.y - 350) * 0.0015) * 0.78;
        point.x = Math.max(35, Math.min(965, point.x + velocity.x));
        point.y = Math.max(35, Math.min(665, point.y + velocity.y));
      }
    }
  } else {
    nodes.forEach((node, index) => points.set(node.id, {
      x: 80 + (index % 10) * 95,
      y: 60 + Math.floor(index / 10) * 70,
    }));
  }

  return Object.fromEntries(points);
}

export function GraphWorkspace() {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const pointerStart = useRef<Point | null>(null);
  const draggedRef = useRef(false);
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_GRAPH_FILTERS);
  const [focusId, setFocusId] = useState("");
  const [depth, setDepth] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [graphCenter, setGraphCenter] = useState<Point>({ x: 500, y: 350 });
  const [fitScale, setFitScale] = useState(1);
  const [draggingNode, setDraggingNode] = useState("");
  const [labelNodeId, setLabelNodeId] = useState("");
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Zooming in trades overview for detail, so names appear once the zoom
  // control is above its reset value. Hover and keyboard focus still work.
  const showAllLabels = zoom >= LABEL_ZOOM;
  const showDatabasePages = useSyncExternalStore(
    subscribeToNavigation,
    getNavigationSnapshot,
    getServerNavigationSnapshot,
  ).showDatabasePages;

  const applyLayout = useCallback((nodes: GraphNode[], edges: GraphEdge[]) => {
    const nextPositions = layoutGraph(nodes, edges);
    setPositions(nextPositions);
    const points = Object.values(nextPositions);
    if (points.length === 0) return;
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    setGraphCenter({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    setFitScale(points.length < 2 ? 1 : Math.max(0.65, Math.min(2.25, 850 / width, 560 / height)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/graph")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load the page graph.");
        return await response.json() as GraphData;
      })
      .then((graph) => {
        if (!cancelled) {
          setData(graph);
          const databasePages = getNavigationSnapshot().showDatabasePages;
          const visible = filterGraph(graph, {
            ...DEFAULT_GRAPH_FILTERS,
            databasePages,
          });
          applyLayout(visible.nodes, visible.edges);
        }
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load the page graph."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applyLayout]);

  // Edit navigation owns record-page visibility, so the graph follows the same
  // preference instead of keeping a second, conflicting filter. The layout is
  // recalculated from the subscription callback, not during an effect render.
  useEffect(
    () =>
      subscribeToNavigation(() => {
        const databasePages = getNavigationSnapshot().showDatabasePages;
        const visible = filterGraph(data, {
          ...DEFAULT_GRAPH_FILTERS,
          databasePages,
        });
        applyLayout(visible.nodes, visible.edges);
      }),
    [applyLayout, data],
  );

  // Record pages are drawn only when the shared preference is on, so every
  // neighbor, tag, group and picker below works from the same node set.
  const baseGraph = useMemo(
    () => filterGraph(data, { ...DEFAULT_GRAPH_FILTERS, databasePages: showDatabasePages }),
    [data, showDatabasePages],
  );

  // A hidden record page cannot stay the center of a local graph.
  const activeFocusId =
    !showDatabasePages &&
    data.nodes.some((node) => node.id === focusId && node.isRecordPage)
      ? ""
      : focusId;

  const tagsByPageId = useMemo(
    () => new Map(baseGraph.nodes.map((node) => [node.id, node.tags])),
    [baseGraph.nodes],
  );
  const nodesById = useMemo(
    () => new Map(baseGraph.nodes.map((node) => [node.id, node])),
    [baseGraph.nodes],
  );

  const visibleIds = useMemo(() => {
    if (!activeFocusId) return new Set(baseGraph.nodes.map((node) => node.id));
    return neighborhoodIds(baseGraph, activeFocusId, depth);
  }, [baseGraph, activeFocusId, depth]);

  const visibleNodes = useMemo(() => baseGraph.nodes.filter((node) => visibleIds.has(node.id)), [baseGraph.nodes, visibleIds]);
  const visibleEdges = useMemo(() => baseGraph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)), [baseGraph.edges, visibleIds]);
  const matchingIds = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return new Set(baseGraph.nodes.filter((node) => node.title.toLocaleLowerCase().includes(normalized)).map((node) => node.id));
  }, [baseGraph.nodes, query]);
  const effectiveFilters = useMemo(
    () => ({ ...filters, databasePages: showDatabasePages }),
    [filters, showDatabasePages],
  );
  const filteredGraph = useMemo(
    () => filterGraph({ nodes: visibleNodes, edges: visibleEdges }, effectiveFilters),
    [visibleNodes, visibleEdges, effectiveFilters],
  );
  // A node grows with the number of visible connections it holds, so the
  // busiest pages read as hubs before any title is read.
  const nodeDegrees = useMemo(() => {
    const degrees = new Map<string, number>();
    for (const node of filteredGraph.nodes) degrees.set(node.id, 0);
    for (const edge of filteredGraph.edges) {
      if (degrees.has(edge.source)) degrees.set(edge.source, degrees.get(edge.source)! + 1);
      if (degrees.has(edge.target)) degrees.set(edge.target, degrees.get(edge.target)! + 1);
    }
    return degrees;
  }, [filteredGraph.nodes, filteredGraph.edges]);
  // Labels are laid out greedily: the hovered page wins, then the centered one,
  // then the busiest pages. Each label tries above, below, right and left, and
  // is placed only where it clears both other labels and every node circle.
  const labelPlacements = useMemo(() => {
    const placements = new Map<string, LabelPlacement>();
    const placedBoxes: Box[] = [];
    const circles: Circle[] = filteredGraph.nodes.flatMap((node) => {
      const point = positions[node.id];
      return point
        ? [{ x: point.x, y: point.y, radius: nodeRadiusFor(nodeDegrees.get(node.id) ?? 0) + 3 }]
        : [];
    });
    const pinned = new Set([activeFocusId, labelNodeId].filter(Boolean));
    const candidates = filteredGraph.nodes
      .filter((node) => showAllLabels || pinned.has(node.id))
      .sort(
        (left, right) =>
          Number(pinned.has(right.id)) - Number(pinned.has(left.id)) ||
          (nodeDegrees.get(right.id) ?? 0) - (nodeDegrees.get(left.id) ?? 0) ||
          (left.title || "Untitled").localeCompare(right.title || "Untitled", undefined, {
            sensitivity: "base",
          }),
      );

    for (const node of candidates) {
      const point = positions[node.id];
      if (!point) continue;
      const radius = nodeRadiusFor(nodeDegrees.get(node.id) ?? 0) + 3;
      const text = truncateLabel(node.title || "Untitled");
      const width = text.length * 6.6 + 10;
      const slots: { x: number; y: number; anchor: LabelAnchor }[] = [
        { x: point.x, y: point.y - radius - 11, anchor: "middle" },
        { x: point.x, y: point.y + radius + 21, anchor: "middle" },
        { x: point.x + radius + 8, y: point.y + 4, anchor: "start" },
        { x: point.x - radius - 8, y: point.y + 4, anchor: "end" },
      ];

      let chosen: { x: number; y: number; anchor: LabelAnchor; box: Box } | null = null;
      for (const slot of slots) {
        const box = labelBox(slot.x, slot.y, width, slot.anchor);
        const outside = box.left < 2 || box.right > 998 || box.top < 2 || box.bottom > 698;
        if (outside) continue;
        if (placedBoxes.some((other) => boxesOverlap(box, other))) continue;
        if (circles.some((circle) => boxHitsCircle(box, circle))) continue;
        chosen = { ...slot, box };
        break;
      }

      // A hovered or centered page must always name itself, even when the
      // canvas is too tight for a clean placement.
      if (!chosen && pinned.has(node.id)) {
        const slot = slots[0];
        chosen = { ...slot, box: labelBox(slot.x, slot.y, width, slot.anchor) };
      }
      if (!chosen) continue;

      placedBoxes.push(chosen.box);
      placements.set(node.id, { x: chosen.x, y: chosen.y, anchor: chosen.anchor, text });
    }

    return placements;
  }, [activeFocusId, filteredGraph.nodes, labelNodeId, nodeDegrees, positions, showAllLabels]);
  const listNodes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return graphListItems(
      filteredGraph.nodes.filter((node) => !normalized || matchingIds.has(node.id)),
    );
  }, [filteredGraph.nodes, matchingIds, query]);
  const tagOptions = useMemo(() => {
    const namesById = new Map<string, string>();
    for (const node of baseGraph.nodes) {
      for (const tag of node.tags) namesById.set(tag.id, tag.name);
    }
    return [...namesById.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [baseGraph.nodes]);
  // Colours follow the alphabetical tag list, not the current filter, so a tag
  // keeps its hue while pages are filtered in and out.
  const tagColors = useMemo(() => {
    const colors = new Map<string, string>();
    tagOptions.forEach((tag, index) => {
      colors.set(tag.id, TAG_PALETTE[index % TAG_PALETTE.length]);
    });
    return colors;
  }, [tagOptions]);
  const visibleTagSwatches = useMemo(() => {
    const seen = new Map<string, string>();
    for (const node of filteredGraph.nodes) {
      for (const tag of node.tags) {
        if (tagColors.has(tag.id)) seen.set(tag.id, tag.name);
      }
    }
    return [...seen.entries()]
      .slice(0, 6)
      .map(([id, name]) => ({ id, name, color: tagColors.get(id)! }));
  }, [filteredGraph.nodes, tagColors]);
  const groupOptions = useMemo(() => {
    const parentIds = new Set(baseGraph.nodes.flatMap((node) => (node.parentId ? [node.parentId] : [])));
    return graphListItems(baseGraph.nodes.filter((node) => parentIds.has(node.id)));
  }, [baseGraph.nodes]);

  const updateFocus = (nextFocusId: string, nextDepth = depth) => {
    setFocusId(nextFocusId);
    const ids = nextFocusId ? neighborhoodIds(baseGraph, nextFocusId, nextDepth) : new Set(baseGraph.nodes.map((node) => node.id));
    const nextNodes = baseGraph.nodes.filter((node) => ids.has(node.id));
    const nextEdges = baseGraph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    applyLayout(nextNodes, nextEdges);
  };

  const updateDepth = (nextDepth: number) => {
    setDepth(nextDepth);
    if (activeFocusId) {
      const ids = neighborhoodIds(baseGraph, activeFocusId, nextDepth);
      const nextNodes = baseGraph.nodes.filter((node) => ids.has(node.id));
      applyLayout(nextNodes, baseGraph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)));
    }
  };

  const beginPan = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.target !== svgRef.current) return;
    pointerStart.current = { x: event.clientX - pan.x, y: event.clientY - pan.y };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const movePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (draggingNode) {
      draggedRef.current = true;
      const x = ((event.clientX - rect.left) / rect.width) * 1000;
      const y = ((event.clientY - rect.top) / rect.height) * 700;
      const scale = zoom * fitScale;
      setPositions((current) => ({
        ...current,
        [draggingNode]: {
          x: graphCenter.x + (x - pan.x - 500) / scale,
          y: graphCenter.y + (y - pan.y - 350) / scale,
        },
      }));
    } else if (pointerStart.current) {
      setPan({ x: event.clientX - pointerStart.current.x, y: event.clientY - pointerStart.current.y });
    }
  };

  const stopPointer = () => {
    pointerStart.current = null;
    setDraggingNode("");
  };

  const nodeRadius = (id: string) => nodeRadiusFor(nodeDegrees.get(id) ?? 0);
  // A page takes the colour of its first tag; untagged pages keep the brand
  // stroke so they still read as pages rather than disappearing.
  const nodeColor = (tags: GraphNode["tags"]) => {
    for (const tag of tags) {
      const color = tagColors.get(tag.id);
      if (color) return color;
    }
    return "var(--primary)";
  };
  // Shared-tag edges borrow the hue of a tag both endpoints carry, so a line
  // and the two nodes it joins agree on colour.
  const sharedTagFor = (edge: GraphEdge) => {
    const targetTagIds = new Set((tagsByPageId.get(edge.target) ?? []).map((tag) => tag.id));
    for (const tag of tagsByPageId.get(edge.source) ?? []) {
      if (targetTagIds.has(tag.id) && tagColors.has(tag.id)) return tag;
    }
    return null;
  };
  const tagEdgeColor = (edge: GraphEdge) => {
    const tag = sharedTagFor(edge);
    return tag ? tagColors.get(tag.id)! : "var(--muted-foreground)";
  };
  const edgeStyle = (edge: GraphEdge) =>
    edge.type === "link"
      ? { stroke: "var(--brand)", width: 2, dash: undefined, opacity: 0.8, bend: 0.14 }
      : edge.type === "hierarchy"
        ? { stroke: "var(--muted-foreground)", width: 1.3, dash: "6 5", opacity: 0.6, bend: 0.08 }
        : { stroke: tagEdgeColor(edge), width: 1.3, dash: "2 4", opacity: 0.6, bend: -0.16 };
  const hoveredEdgeView = (() => {
    if (!hoveredEdgeKey) return null;
    const index = filteredGraph.edges.findIndex((edge, candidateIndex) => edgeKey(edge, candidateIndex) === hoveredEdgeKey);
    if (index < 0) return null;
    const edge = filteredGraph.edges[index];
    const source = positions[edge.source];
    const target = positions[edge.target];
    if (!source || !target) return null;

    const geometry = edgePath(
      source,
      target,
      nodeRadius(edge.source) + 1,
      nodeRadius(edge.target) + (edge.type === "hierarchy" ? 8 : 1),
      edgeStyle(edge).bend,
    );
    const sourceTitle = truncateLabel(nodesById.get(edge.source)?.title || "Untitled", 22);
    const targetTitle = truncateLabel(nodesById.get(edge.target)?.title || "Untitled", 22);
    const tag = edge.type === "tag" ? sharedTagFor(edge) : null;
    const text = edge.type === "link"
      ? `Page link · ${sourceTitle} → ${targetTitle}`
      : edge.type === "hierarchy"
        ? `Parent → child · ${sourceTitle} → ${targetTitle}`
        : `Shared tag${tag ? ` “${tag.name}”` : ""} · ${sourceTitle} ↔ ${targetTitle}`;
    const width = Math.min(430, text.length * 6.6 + 22);
    return {
      text,
      width,
      left: clamp(geometry.mid.x - width / 2, 8, 992 - width),
      top: clamp(geometry.mid.y - 40 < 8 ? geometry.mid.y + 14 : geometry.mid.y - 40, 8, 668),
    };
  })();

  if (loading) return <div role="status" className="animate-pulse rounded-xl border p-8 text-sm text-muted-foreground">Building page graph…</div>;
  if (error) return <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}</div>;

  return (
    <section className="mx-auto w-full max-w-5xl space-y-5">
      <div>
        <Link href="/" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={15} aria-hidden="true" /> Back to workspace
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Knowledge graph</h1>
        <p className="mt-2 text-sm text-muted-foreground">Explore links between pages and move through your workspace visually.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
        <label className="flex min-w-48 flex-1 items-center gap-2 rounded-md border px-3 py-2">
          <Search size={16} className="text-muted-foreground" aria-hidden="true" />
          <input aria-label="Find a page in the graph" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a page…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Center local graph
          <select value={activeFocusId} onChange={(event) => updateFocus(event.target.value)} className="min-w-48 rounded-md border bg-background px-2 py-2 text-sm text-foreground">
            <option value="">Workspace graph</option>
            {baseGraph.nodes.map((node) => <option key={node.id} value={node.id}>{node.title || "Untitled"}</option>)}
          </select>
        </label>
        {activeFocusId && (
          <label className="grid gap-1 text-xs text-muted-foreground">
            Neighborhood depth
            <select value={depth} onChange={(event) => updateDepth(Number(event.target.value))} className="rounded-md border bg-background px-2 py-2 text-sm text-foreground">
              <option value={1}>1 step</option><option value={2}>2 steps</option><option value={3}>3 steps</option>
            </select>
          </label>
        )}
        <label className="grid gap-1 text-xs text-muted-foreground">
          Tag
          <select
            aria-label="Filter graph by tag"
            value={filters.tagId}
            onChange={(event) => setFilters((current) => ({ ...current, tagId: event.target.value }))}
            className="min-w-40 rounded-md border bg-background px-2 py-2 text-sm text-foreground"
          >
            <option value="">All tags</option>
            {tagOptions.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Page group
          <select
            aria-label="Limit graph to a page group"
            value={filters.groupRootId}
            onChange={(event) => setFilters((current) => ({ ...current, groupRootId: event.target.value }))}
            className="min-w-40 rounded-md border bg-background px-2 py-2 text-sm text-foreground"
          >
            <option value="">Whole workspace</option>
            {groupOptions.map((node) => (
              <option key={node.id} value={node.id}>{node.title || "Untitled"}</option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-wrap items-center gap-3 text-xs">
          <legend className="sr-only">Graph filters</legend>
          <span className="font-medium text-muted-foreground">Show</span>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.links}
              onChange={(event) => setFilters((current) => ({ ...current, links: event.target.checked }))}
            />
            Page links
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.hierarchy}
              onChange={(event) => setFilters((current) => ({ ...current, hierarchy: event.target.checked }))}
            />
            Parent / child
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.favoritesOnly}
              onChange={(event) => setFilters((current) => ({ ...current, favoritesOnly: event.target.checked }))}
            />
            Favorites only
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.sharedTags}
              onChange={(event) => setFilters((current) => ({ ...current, sharedTags: event.target.checked }))}
            />
            Shared tags
          </label>
        </fieldset>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.45, value - 0.15))} className="rounded-md border p-2 hover:bg-accent"><Minus size={16} /></button>
          <span className="w-12 text-center text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2.5, value + 0.15))} className="rounded-md border p-2 hover:bg-accent"><Plus size={16} /></button>
          <button type="button" onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); }} className="rounded-md border px-2 py-2 text-xs hover:bg-accent">Reset</button>
        </div>
      </div>

      {data.nodes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <Link2 className="mx-auto mb-3 text-muted-foreground" />
          <h2 className="font-medium">No pages to map yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create pages and connect them to see your knowledge graph.</p>
        </div>
      ) : filteredGraph.nodes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {filters.favoritesOnly || filters.tagId || filters.groupRootId || !filters.links || !filters.hierarchy
            ? "No pages match these filters."
            : "No connected pages at this neighborhood depth."}
        </div>
      ) : (
        <div className="space-y-3">
          <nav aria-label="Graph pages list" className="rounded-xl border bg-card p-3 md:hidden">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {listNodes.length} {listNodes.length === 1 ? "page" : "pages"}
            </p>
            {listNodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pages match these filters.</p>
            ) : (
              <ul className="space-y-1">
                {listNodes.map((node) => (
                  <li key={node.id}>
                    <Link
                      href={`/pages/${node.id}`}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      {node.isFavorite ? (
                        <Star size={12} className="fill-amber-500 text-amber-500" aria-hidden="true" />
                      ) : (
                        <Link2 size={12} className="text-muted-foreground" aria-hidden="true" />
                      )}
                      <span className="min-w-0 truncate">{node.title || "Untitled"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </nav>
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
          <svg
            ref={svgRef}
            viewBox="0 0 1000 700"
            role="application"
            aria-label="Interactive graph of pages"
            className="h-[58vh] min-h-[420px] w-full touch-none cursor-grab active:cursor-grabbing"
            onPointerDown={beginPan}
            onPointerMove={movePointer}
            onPointerUp={stopPointer}
            onPointerCancel={stopPointer}
          >
            <defs>
              {/* The canvas sits behind the graph and does not pan or zoom, so
                  the grid reads as a fixed surface rather than part of the data. */}
              <pattern id="graph-canvas-dots" width="28" height="28" patternUnits="userSpaceOnUse">
                <circle cx="1.5" cy="1.5" r="1" fill="var(--muted-foreground)" />
              </pattern>
              <radialGradient id="graph-canvas-glow" cx="50%" cy="45%" r="65%">
                <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.12" />
                <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
              </radialGradient>
              {/* Hierarchy lines point from parent to child, so direction is
                  legible without relying on the dash pattern alone. */}
              <marker id="graph-hierarchy-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" opacity="0.75" />
              </marker>
            </defs>
            <rect width="1000" height="700" fill="var(--background)" pointerEvents="none" />
            <rect width="1000" height="700" fill="url(#graph-canvas-dots)" opacity="0.22" pointerEvents="none" />
            <rect width="1000" height="700" fill="url(#graph-canvas-glow)" pointerEvents="none" />
            <g transform={`translate(${pan.x} ${pan.y}) translate(500 350) scale(${zoom * fitScale}) translate(${-graphCenter.x} ${-graphCenter.y})`}>
              {filteredGraph.edges.map((edge, index) => {
                const source = positions[edge.source];
                const target = positions[edge.target];
                if (!source || !target) return null;
                // Each relation reads differently: links are the only solid
                // brand-coloured lines, hierarchy is a dashed parent-to-child
                // arrow, and shared tags are a faint dotted line.
                const style = edgeStyle(edge);
                const key = edgeKey(edge, index);
                const hovered = hoveredEdgeKey === key;
                const geometry = edgePath(
                  source,
                  target,
                  nodeRadius(edge.source) + 1,
                  nodeRadius(edge.target) + (edge.type === "hierarchy" ? 8 : 1),
                  style.bend,
                );
                return (
                  <g
                    key={key}
                    onPointerEnter={() => setHoveredEdgeKey(key)}
                    onPointerLeave={() => setHoveredEdgeKey((current) => (current === key ? "" : current))}
                  >
                    <path
                      className="graph-edge"
                      d={geometry.d}
                      fill="none"
                      stroke={style.stroke}
                      strokeWidth={style.width + (hovered ? 0.9 : 0)}
                      strokeDasharray={style.dash}
                      strokeLinecap={style.dash ? "round" : undefined}
                      opacity={hovered ? 1 : style.opacity}
                      markerEnd={edge.type === "hierarchy" ? "url(#graph-hierarchy-arrow)" : undefined}
                    />
                    {/* A wide invisible stroke makes a thin line easy to hover. */}
                    <path
                      d={geometry.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      pointerEvents="stroke"
                    />
                  </g>
                );
              })}
              {filteredGraph.nodes.map((node) => {
                const point = positions[node.id];
                if (!point) return null;
                const matched = !query || matchingIds.has(node.id);
                const focused = activeFocusId === node.id;
                const radius = nodeRadius(node.id);
                const color = nodeColor(node.tags);
                const label = labelPlacements.get(node.id);
                return (
                  <g
                    key={node.id}
                    role="link"
                    tabIndex={0}
                    aria-label={`Open page ${node.title || "Untitled"}`}
                    className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-[4]"
                    opacity={matched ? 1 : 0.14}
                    onPointerEnter={() => setLabelNodeId(node.id)}
                    onPointerLeave={() => setLabelNodeId((current) => (current === node.id ? "" : current))}
                    onFocus={() => setLabelNodeId(node.id)}
                    onBlur={() => setLabelNodeId((current) => (current === node.id ? "" : current))}
                    onPointerDown={(event) => { event.stopPropagation(); draggedRef.current = false; setDraggingNode(node.id); event.currentTarget.setPointerCapture(event.pointerId); }}
                    onClick={() => { if (!draggedRef.current) router.push(`/pages/${node.id}`); }}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); router.push(`/pages/${node.id}`); } }}
                  >
                    <circle cx={point.x} cy={point.y} r={focused ? radius + 4 : radius} fill={color} fillOpacity={focused ? 0.92 : 0.2} stroke={color} strokeWidth={focused ? 3 : 2} />
                    {node.isFavorite && <foreignObject x={point.x + radius - 3} y={point.y - radius - 12} width="18" height="18"><Star size={13} className="fill-amber-500 text-amber-500" aria-hidden="true" /></foreignObject>}
                    {label && (
                      <text
                        x={label.x}
                        y={label.y}
                        textAnchor={label.anchor}
                        className="fill-foreground text-[12px] font-medium"
                        stroke="var(--background)"
                        strokeWidth={4}
                        paintOrder="stroke"
                        style={{ pointerEvents: "none" }}
                        aria-hidden="true"
                      >
                        {label.text}
                      </text>
                    )}
                  </g>
                );
              })}
              {hoveredEdgeView && (
                <g
                  transform={`translate(${hoveredEdgeView.left} ${hoveredEdgeView.top})`}
                  pointerEvents="none"
                  aria-hidden="true"
                >
                  <rect
                    width={hoveredEdgeView.width}
                    height={24}
                    rx={7}
                    className="fill-popover stroke-border"
                    strokeWidth={1}
                    opacity={0.98}
                  />
                  <text
                    x={hoveredEdgeView.width / 2}
                    y={16}
                    textAnchor="middle"
                    className="fill-popover-foreground text-[12px]"
                  >
                    {hoveredEdgeView.text}
                  </text>
                </g>
              )}
            </g>
          </svg>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-4 py-3 text-xs text-muted-foreground">
            <span>{filteredGraph.nodes.length} pages</span>
            <span className="flex items-center gap-2"><span aria-hidden="true" className="inline-block w-5 border-t-2 border-brand" />Page link</span>
            <span className="flex items-center gap-2"><span aria-hidden="true" className="inline-block w-5 border-t border-dashed border-muted-foreground" />Parent → child</span>
            <span className="flex items-center gap-2"><span aria-hidden="true" className="inline-block h-0.5 w-5" style={{ backgroundImage: `linear-gradient(90deg, ${TAG_PALETTE.slice(0, 4).join(", ")})` }} />Shared tag</span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block size-2 rounded-full border-2 border-primary bg-card" />
              <span aria-hidden="true" className="inline-block size-3.5 rounded-full border-2 border-primary bg-card" />
              Size = connections
            </span>
            {visibleTagSwatches.length > 0 && (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                Tags
                {visibleTagSwatches.map((tag) => (
                  <span key={tag.id} className="flex items-center gap-1">
                    <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span className="max-w-24 truncate">{tag.name}</span>
                  </span>
                ))}
              </span>
            )}
            <span className="ml-auto">Hover a title · Zoom in to label every page · Drag to pan or move · Select to open</span>
          </div>
          </div>
        </div>
      )}
    </section>
  );
}
