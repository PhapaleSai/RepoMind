"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, FileCode2, Sigma, ZoomIn, ZoomOut } from "lucide-react";
import type { GraphEdge, GraphNode, RepoGraph } from "@/lib/graph";

// Graphify-style force-directed node graph: file nodes connected by real import edges, plus
// symbol nodes (functions/classes, from lib/graph.ts) connected both to their own file and to
// other files that textually reference them — an approximate cross-file call graph. Clicking a
// dot opens a detail panel; the canvas always renders at the full width of its container (no
// viewport-breakpoint-based side-by-side split, since this panel's container width varies a lot
// depending on where it's embedded) so it never gets squeezed down to a sliver.

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

const WIDTH = 1000;
const HEIGHT = 720;
const ITERATIONS_PER_FRAME = 1;
const SETTLE_FRAMES = 280;

function buildSim(nodes: GraphNode[], edges: GraphEdge[]): SimNode[] {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  return nodes.map((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const r = Math.min(WIDTH, HEIGHT) * (n.kind === "file" ? 0.36 : 0.44);
    return {
      ...n,
      x: WIDTH / 2 + Math.cos(angle) * r,
      y: HEIGHT / 2 + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
      degree: degree.get(n.id) ?? 0,
    };
  });
}

function step(nodes: SimNode[], edges: GraphEdge[], byId: Map<string, SimNode>) {
  const REPEL = 2400;
  const SPRING = 0.02;
  const CENTER = 0.008;
  const DAMPING = 0.85;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let distSq = dx * dx + dy * dy || 0.01;
      const dist = Math.sqrt(distSq);
      const force = REPEL / distSq;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      a.vx += dx;
      a.vy += dy;
      b.vx -= dx;
      b.vy -= dy;
    }
  }

  for (const e of edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    // Symbol<->file "contains" edges are pulled tighter than file<->file import edges, so
    // symbols cluster visibly around their own file instead of floating loose.
    const bothFiles = a.kind === "file" && b.kind === "file";
    const springLen = bothFiles ? 110 : 40;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const f = SPRING * (dist - springLen);
    const fx = (dx / dist) * f;
    const fy = (dy / dist) * f;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  for (const n of nodes) {
    n.vx += (WIDTH / 2 - n.x) * CENTER;
    n.vy += (HEIGHT / 2 - n.y) * CENTER;
    n.vx *= DAMPING;
    n.vy *= DAMPING;
    n.x += n.vx * 0.05;
    n.y += n.vy * 0.05;
    n.x = Math.max(10, Math.min(WIDTH - 10, n.x));
    n.y = Math.max(10, Math.min(HEIGHT - 10, n.y));
  }
}

function nodeRadius(n: SimNode): number {
  if (n.kind === "file") return 4 + Math.min(n.degree, 10) * 0.6;
  return 2.5 + Math.min(n.degree, 6) * 0.4;
}

export default function GraphView({ repositoryId }: { repositoryId: string }) {
  const [graph, setGraph] = useState<RepoGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const [selected, setSelected] = useState<SimNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimNode[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setSelected(null);
    (async () => {
      try {
        const res = await fetch("/api/graph", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repositoryId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to build graph");
        if (!cancelled) setGraph(data.graph);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Something went wrong");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repositoryId]);

  useEffect(() => {
    if (!graph) return;
    simRef.current = buildSim(graph.nodes, graph.edges);
    setHidden(new Set());
    setSelected(null);
    setZoom(1);
  }, [graph]);

  useEffect(() => {
    if (!graph) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let frame = 0;
    const idMap = new Map(simRef.current.map((n) => [n.id, n]));

    function visible(n: SimNode) {
      return !hidden.has(n.community);
    }

    function draw() {
      if (frame < SETTLE_FRAMES) {
        for (let k = 0; k < ITERATIONS_PER_FRAME; k++) step(simRef.current, graph!.edges, idMap);
      }
      frame++;

      ctx!.clearRect(0, 0, WIDTH, HEIGHT);
      ctx!.save();
      // Zoom centered on the canvas midpoint — dragging the slider back to 1 restores the
      // original layout exactly since this only ever scales the drawing, never the sim state.
      ctx!.translate(WIDTH / 2, HEIGHT / 2);
      ctx!.scale(zoom, zoom);
      ctx!.translate(-WIDTH / 2, -HEIGHT / 2);

      for (const e of graph!.edges) {
        const a = idMap.get(e.source);
        const b = idMap.get(e.target);
        if (!a || !b || !visible(a) || !visible(b)) continue;
        const bothFiles = a.kind === "file" && b.kind === "file";
        ctx!.strokeStyle = bothFiles ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)";
        ctx!.lineWidth = bothFiles ? 1 : 0.6;
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
      }

      const colorOf = new Map(graph!.communities.map((c) => [c.name, c.color]));
      for (const n of simRef.current) {
        if (!visible(n)) continue;
        const radius = nodeRadius(n);
        const color = colorOf.get(n.community) ?? "#8ab4f8";

        if (selected?.id === n.id) {
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, radius + 4, 0, Math.PI * 2);
          ctx!.strokeStyle = "rgba(255,255,255,0.85)";
          ctx!.lineWidth = 1.5;
          ctx!.stroke();
        }

        ctx!.beginPath();
        ctx!.arc(n.x, n.y, radius, 0, Math.PI * 2);
        if (n.kind === "symbol") {
          ctx!.globalAlpha = 0.55;
          ctx!.fillStyle = color;
          ctx!.fill();
          ctx!.globalAlpha = 1;
        } else {
          ctx!.fillStyle = color;
          ctx!.fill();
        }
      }

      ctx!.restore();
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [graph, hidden, selected, zoom]);

  function nodeAtPoint(e: React.MouseEvent<HTMLCanvasElement>): SimNode | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const screenX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const screenY = ((e.clientY - rect.top) / rect.height) * HEIGHT;
    // Invert the draw-time zoom transform (translate to center, scale, translate back) so hit
    // testing lines up with what's actually rendered at the current zoom level.
    const x = (screenX - WIDTH / 2) / zoom + WIDTH / 2;
    const y = (screenY - HEIGHT / 2) / zoom + HEIGHT / 2;
    let closest: SimNode | null = null;
    let closestDist = 14 / zoom;
    for (const n of simRef.current) {
      if (hidden.has(n.community)) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < closestDist) {
        closestDist = d;
        closest = n;
      }
    }
    return closest;
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const n = nodeAtPoint(e);
    setHoverLabel(n ? (n.kind === "file" ? n.id : `${n.label}() — ${n.file}`) : null);
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    setSelected(nodeAtPoint(e));
  }

  function toggleCommunity(name: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll(select: boolean) {
    setHidden(select ? new Set() : new Set(graph?.communities.map((c) => c.name)));
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-xs text-white/40">
        <Loader2 className="h-4 w-4 animate-spin" /> Building graph from ingested files…
      </div>
    );
  }
  if (error) {
    return <p className="text-xs text-red-300/80">{error}</p>;
  }
  if (!graph || graph.nodes.length === 0) {
    return <p className="text-xs text-white/40">No file relationships found to graph yet.</p>;
  }

  const allSelected = hidden.size === 0;
  const fileCount = (name: string) => graph.nodes.filter((n) => n.community === name && n.kind === "file").length;
  const colorOf = new Map(graph.communities.map((c) => [c.name, c.color]));

  const selectedFileSymbols =
    selected?.kind === "file" ? graph.nodes.filter((n) => n.kind === "symbol" && n.file === selected.id) : [];
  const referencingFiles =
    selected?.kind === "symbol"
      ? [...new Set(graph.edges.filter((e) => e.target === selected.id).map((e) => e.source))]
      : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
        <ZoomOut className="h-3.5 w-3.5 shrink-0 text-white/40" />
        <input
          type="range"
          min={1}
          max={4}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-indigo-500"
        />
        <ZoomIn className="h-3.5 w-3.5 shrink-0 text-white/40" />
        <span className="w-9 shrink-0 text-right font-mono text-[11px] text-white/40">{zoom.toFixed(1)}x</span>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black/30">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverLabel(null)}
          onClick={handleClick}
          className="h-auto w-full cursor-pointer"
        />
        {hoverLabel && !selected && (
          <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] text-white/80">
            {hoverLabel}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="glass-chip rounded-xl p-3">
          {selected ? (
            <>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 overflow-hidden">
                  {selected.kind === "file" ? (
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-white/50" />
                  ) : (
                    <Sigma className="h-3.5 w-3.5 shrink-0 text-white/50" />
                  )}
                  <p className="truncate font-mono text-[11px] text-white/80" title={selected.id}>
                    {selected.kind === "file" ? selected.id : `${selected.label}()`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="shrink-0 text-[11px] text-white/40 hover:text-white/70"
                >
                  ✕
                </button>
              </div>

              {selected.kind === "file" ? (
                <>
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] text-white/40">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf.get(selected.community) }} />
                    {selected.community} · {selectedFileSymbols.length} symbol{selectedFileSymbols.length === 1 ? "" : "s"}
                  </div>
                  {selectedFileSymbols.length > 0 ? (
                    <ul className="scrollbar-thin max-h-44 space-y-1 overflow-y-auto pr-1">
                      {selectedFileSymbols.map((s) => (
                        <li key={s.id} className="flex items-center gap-1.5 rounded-md bg-white/[0.03] px-2 py-1 text-xs">
                          <span
                            className={`rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                              s.symbolKind === "class" ? "bg-fuchsia-400/15 text-fuchsia-300" : "bg-indigo-400/15 text-indigo-300"
                            }`}
                          >
                            {s.symbolKind === "class" ? "class" : "fn"}
                          </span>
                          <span className="truncate font-mono text-white/80">{s.label}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-white/30">No functions or classes detected in this file.</p>
                  )}
                </>
              ) : (
                <>
                  <p className="mb-2 text-[11px] text-white/40">
                    <span
                      className={`mr-1 rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                        selected.symbolKind === "class" ? "bg-fuchsia-400/15 text-fuchsia-300" : "bg-indigo-400/15 text-indigo-300"
                      }`}
                    >
                      {selected.symbolKind === "class" ? "class" : "function"}
                    </span>
                    defined in <span className="font-mono text-white/60">{selected.file}</span>
                  </p>
                  {referencingFiles.length > 0 ? (
                    <>
                      <p className="mb-1 text-[11px] text-white/40">Referenced from:</p>
                      <ul className="scrollbar-thin max-h-32 space-y-1 overflow-y-auto pr-1">
                        {referencingFiles.map((f) => (
                          <li key={f} className="truncate rounded-md bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-white/70">
                            {f}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="text-xs text-white/30">No other files reference this symbol by name.</p>
                  )}
                </>
              )}
            </>
          ) : (
            <p className="text-xs text-white/40">
              Click a big dot for a file's functions/classes, or a small dot for where that symbol is used.
            </p>
          )}
        </div>

        <div className="glass-chip rounded-xl p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">Communities</p>
          <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-white/70">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => toggleAll(e.target.checked)}
              className="h-3.5 w-3.5 accent-indigo-500"
            />
            Select all
          </label>
          <div className="scrollbar-thin max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {graph.communities.map((c) => (
              <label key={c.name} className="flex cursor-pointer items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={!hidden.has(c.name)}
                  onChange={() => toggleCommunity(c.name)}
                  className="h-3.5 w-3.5 accent-indigo-500"
                />
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="truncate" title={c.name}>{c.name}</span>
                <span className="ml-auto shrink-0 text-white/30">{fileCount(c.name)}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
