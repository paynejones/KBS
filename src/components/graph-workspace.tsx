"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Link2, Minus, Plus, Search, Star } from "lucide-react";

type GraphNode = { id: string; title: string; isFavorite: boolean };
type GraphEdge = { source: string; target: string; type: "link" | "hierarchy" };
type Point = { x: number; y: number };
type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

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
      ) : visibleNodes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No connected pages at this neighborhood depth.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
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
              {visibleEdges.map((edge, index) => {
                const source = positions[edge.source];
                const target = positions[edge.target];
                if (!source || !target) return null;
                return <line key={`${edge.type}-${edge.source}-${edge.target}-${index}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={edge.type === "link" ? "var(--primary)" : "var(--border)"} strokeWidth={edge.type === "link" ? 1.8 : 1.2} strokeDasharray={edge.type === "hierarchy" ? "5 5" : undefined} opacity={edge.type === "link" ? 0.65 : 0.8} />;
              })}
              {visibleNodes.map((node) => {
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
            <span>{visibleNodes.length} pages</span>
            <span className="flex items-center gap-2"><span className="inline-block w-5 border-t-2 border-primary" />Page link</span>
            <span className="flex items-center gap-2"><span className="inline-block w-5 border-t border-dashed border-muted-foreground" />Parent / child</span>
            <span className="ml-auto">Drag to pan or move a page · Select a node to open</span>
          </div>
        </div>
      )}
    </section>
  );
}
