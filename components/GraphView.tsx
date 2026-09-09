"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { GraphEdge, GraphNode, RepoGraph } from "@/lib/graph";

// Graphify-style force-directed node graph — a real dependency graph of the repo's files
// (nodes) and their import relationships (edges), colored by top-level folder ("community"),
// with a toggleable legend, mirroring the reference graphify UI: dots + lines on the left,
// a "COMMUNITIES" checklist with counts on the right.

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

const WIDTH = 720;
const HEIGHT = 480;
const ITERATIONS_PER_FRAME = 1;

function buildSim(nodes: GraphNode[], edges: GraphEdge[]): SimNode[] {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  return nodes.map((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const r = Math.min(WIDTH, HEIGHT) * 0.35;
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
  const REPEL = 1800;
  const SPRING = 0.02;
  const SPRING_LEN = 70;
  const CENTER = 0.01;
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
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const f = SPRING * (dist - SPRING_LEN);
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

export default function GraphView({ repositoryId }: { repositoryId: string }) {
  const [graph, setGraph] = useState<RepoGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimNode[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
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
  }, [graph]);

  const byId = useMemo(() => new Map(simRef.current.map((n) => [n.id, n])), [graph]);

  useEffect(() => {
    if (!graph) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let frame = 0;
    const idMap = new Map(simRef.current.map((n) => [n.id, n]));

    function draw() {
      if (frame < 220) {
        for (let k = 0; k < ITERATIONS_PER_FRAME; k++) step(simRef.current, graph!.edges, idMap);
      }
      frame++;

      ctx!.clearRect(0, 0, WIDTH, HEIGHT);
      ctx!.strokeStyle = "rgba(255,255,255,0.08)";
      ctx!.lineWidth = 1;
      for (const e of graph!.edges) {
        const a = idMap.get(e.source);
        const b = idMap.get(e.target);
        if (!a || !b || hidden.has(a.community) || hidden.has(b.community)) continue;
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
      }

      const colorOf = new Map(graph!.communities.map((c) => [c.name, c.color]));
      for (const n of simRef.current) {
        if (hidden.has(n.community)) continue;
        const radius = 2.5 + Math.min(n.degree, 8) * 0.6;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx!.fillStyle = colorOf.get(n.community) ?? "#8ab4f8";
        ctx!.fill();
      }

      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [graph, hidden]);

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * HEIGHT;
    let closest: SimNode | null = null;
    let closestDist = 12;
    for (const n of simRef.current) {
      if (hidden.has(n.community)) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < closestDist) {
        closestDist = d;
        closest = n;
      }
    }
    setHoverLabel(closest ? closest.id : null);
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
  const degreeCount = (name: string) => graph.nodes.filter((n) => n.community === name).length;

  return (
    <div className="flex flex-col gap-3 md:flex-row">
      <div className="relative flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/30">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverLabel(null)}
          className="h-auto w-full cursor-crosshair"
        />
        {hoverLabel && (
          <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] text-white/80">
            {hoverLabel}
          </div>
        )}
      </div>

      <div className="glass-chip w-full shrink-0 rounded-xl p-3 md:w-56">
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
        <div className="scrollbar-thin max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {graph.communities.map((c) => (
            <label key={c.name} className="flex cursor-pointer items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={!hidden.has(c.name)}
                onChange={() => toggleCommunity(c.name)}
                className="h-3.5 w-3.5 accent-indigo-500"
              />
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
              <span className="truncate">{c.name}</span>
              <span className="ml-auto text-white/30">{degreeCount(c.name)}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
