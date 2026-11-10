"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type Point = { x: number; y: number };

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    void fetch("/api/graph?excludeRecordPages=true")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load the page graph.");
        return await response.json() as GraphData;
      })
      .then((graph) => {
        if (!cancelled) {
          setData(graph);
          applyLayout(graph.nodes, graph.edges);
        }
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load the page graph."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applyLayout]);

  const visibleIds = useMemo(() => {
    if (!focusId) return new Set(data.nodes.map((node) => node.id));
    return neighborhoodIds(data, focusId, depth);
  }, [data, focusId, depth]);

  const visibleNodes = useMemo(() => data.nodes.filter((node) => visibleIds.has(node.id)), [data.nodes, visibleIds]);
  const visibleEdges = useMemo(() => data.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)), [data.edges, visibleIds]);
  const matchingIds = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return new Set(data.nodes.filter((node) => node.title.toLocaleLowerCase().includes(normalized)).map((node) => node.id));
  }, [data.nodes, query]);
  const filteredGraph = useMemo(
    () => filterGraph({ nodes: visibleNodes, edges: visibleEdges }, filters),
    [visibleNodes, visibleEdges, filters],
  );
  const listNodes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return graphListItems(
      filteredGraph.nodes.filter((node) => !normalized || matchingIds.has(node.id)),
    );
  }, [filteredGraph.nodes, matchingIds, query]);
  const tagOptions = useMemo(() => {
    const namesById = new Map<string, string>();
    for (const node of data.nodes) {
      for (const tag of node.tags) namesById.set(tag.id, tag.name);
    }
    return [...namesById.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [data.nodes]);
  const groupOptions = useMemo(() => {
    const parentIds = new Set(data.nodes.flatMap((node) => (node.parentId ? [node.parentId] : [])));
    return graphListItems(data.nodes.filter((node) => parentIds.has(node.id)));
  }, [data.nodes]);

  const updateFocus = (nextFocusId: string, nextDepth = depth) => {
    setFocusId(nextFocusId);
    const ids = nextFocusId ? neighborhoodIds(data, nextFocusId, nextDepth) : new Set(data.nodes.map((node) => node.id));
    const nextNodes = data.nodes.filter((node) => ids.has(node.id));
    const nextEdges = data.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    applyLayout(nextNodes, nextEdges);
  };

  const updateDepth = (nextDepth: number) => {
    setDepth(nextDepth);
    if (focusId) {
      const ids = neighborhoodIds(data, focusId, nextDepth);
      const nextNodes = data.nodes.filter((node) => ids.has(node.id));
      applyLayout(nextNodes, data.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)));
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
          <select value={focusId} onChange={(event) => updateFocus(event.target.value)} className="min-w-48 rounded-md border bg-background px-2 py-2 text-sm text-foreground">
            <option value="">Workspace graph</option>
            {data.nodes.map((node) => <option key={node.id} value={node.id}>{node.title || "Untitled"}</option>)}
          </select>
        </label>
        {focusId && (
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
            <g transform={`translate(${pan.x} ${pan.y}) translate(500 350) scale(${zoom * fitScale}) translate(${-graphCenter.x} ${-graphCenter.y})`}>
              {filteredGraph.edges.map((edge, index) => {
                const source = positions[edge.source];
                const target = positions[edge.target];
                if (!source || !target) return null;
                const stroke = edge.type === "link" ? "var(--primary)" : edge.type === "tag" ? "var(--muted-foreground)" : "var(--border)";
                const dash = edge.type === "hierarchy" ? "5 5" : edge.type === "tag" ? "2 4" : undefined;
                return <line key={`${edge.type}-${edge.source}-${edge.target}-${index}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={stroke} strokeWidth={edge.type === "link" ? 1.8 : 1.2} strokeDasharray={dash} opacity={edge.type === "link" ? 0.65 : 0.8} />;
              })}
              {filteredGraph.nodes.map((node) => {
                const point = positions[node.id];
                if (!point) return null;
                const matched = !query || matchingIds.has(node.id);
                const focused = focusId === node.id;
                return (
                  <g
                    key={node.id}
                    role="link"
                    tabIndex={0}
                    aria-label={`Open page ${node.title || "Untitled"}`}
                    className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-[4]"
                    opacity={matched ? 1 : 0.14}
                    onPointerDown={(event) => { event.stopPropagation(); draggedRef.current = false; setDraggingNode(node.id); event.currentTarget.setPointerCapture(event.pointerId); }}
                    onClick={() => { if (!draggedRef.current) router.push(`/pages/${node.id}`); }}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); router.push(`/pages/${node.id}`); } }}
                  >
                    <circle cx={point.x} cy={point.y} r={focused ? 17 : 13} fill={focused ? "var(--primary)" : "var(--card)"} stroke="var(--primary)" strokeWidth={focused ? 3 : 2} />
                    {node.isFavorite && <foreignObject x={point.x + 8} y={point.y - 23} width="18" height="18"><Star size={13} className="fill-amber-500 text-amber-500" aria-hidden="true" /></foreignObject>}
                    <text x={point.x} y={point.y + 31} textAnchor="middle" className="fill-foreground text-[12px]" style={{ pointerEvents: "none" }}>{node.title || "Untitled"}</text>
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-4 py-3 text-xs text-muted-foreground">
            <span>{filteredGraph.nodes.length} pages</span>
            <span className="flex items-center gap-2"><span className="inline-block w-5 border-t-2 border-primary" />Page link</span>
            <span className="flex items-center gap-2"><span className="inline-block w-5 border-t border-dashed border-muted-foreground" />Parent / child</span>
            <span className="flex items-center gap-2"><span className="inline-block w-5 border-t border-dotted border-muted-foreground" />Shared tag</span>
            <span className="ml-auto">Drag to pan or move a page · Select a node to open</span>
          </div>
          </div>
        </div>
      )}
    </section>
  );
}
