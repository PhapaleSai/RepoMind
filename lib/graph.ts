import { getPool } from "./db";

// Graphify-style knowledge graph (user request: "like graphify graph so user can understand it
// properly via dots"): a real, deterministic node-link graph of the repo's files and their import
// relationships — built straight from the ingested chunks already in Postgres, no LLM call, so
// it's free, instant, and never hallucinated (unlike the Mermaid diagrams which the model invents).

export interface GraphNode {
  id: string;
  label: string;
  community: string;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphCommunity {
  name: string;
  color: string;
}

export interface RepoGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: GraphCommunity[];
}

// A repo with thousands of files would make the force layout unreadable and slow (our layout is
// O(n^2) per frame) — cap it and keep the most-connected files, same tradeoff graphify's own
// "top N nodes" view makes.
const MAX_NODES = 200;

const PALETTE = [
  "#f28b82", "#8ab4f8", "#fdd663", "#81c995", "#c58af9",
  "#78d9ec", "#ff8bcb", "#a8c7fa", "#f6aea9", "#a1e8d3",
];

function communityOf(filePath: string): string {
  const parts = filePath.split("/");
  return parts.length > 1 ? parts[0] : "root";
}

const IMPORT_PATTERNS = [
  // JS/TS: import ... from "./x"; require("./x")
  /(?:from\s+|require\()\s*["'](\.[^"']+)["']/g,
  // Python: from .x import y / from x.y import z / import x.y
  /^\s*from\s+([.\w]+)\s+import\b/gm,
  /^\s*import\s+([.\w]+)/gm,
];

function extractImportSpecs(content: string): string[] {
  const specs: string[] = [];
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) specs.push(m[1]);
  }
  return specs;
}

// Best-effort resolution of an import specifier to one of the repo's actual file paths —
// tries relative-path joining, extension guessing, and dotted-module-to-path conversion.
// Returns undefined rather than guessing wrong (no edge is better than a fake one).
function resolveImport(spec: string, fromFile: string, filePaths: Set<string>): string | undefined {
  const candidates: string[] = [];
  const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".py", "/index.ts", "/index.tsx", "/index.js"];

  if (spec.startsWith(".")) {
    const dir = fromFile.split("/").slice(0, -1);
    const segments = spec.split("/");
    for (const seg of segments) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") dir.pop();
      else dir.push(seg);
    }
    const base = dir.join("/");
    for (const ext of exts) candidates.push(base + ext);
  } else if (spec.includes(".")) {
    // Python dotted module, e.g. "pkg.mod" -> "pkg/mod.py"
    const base = spec.replace(/\./g, "/");
    for (const ext of ["", ".py", "/__init__.py"]) candidates.push(base + ext);
  }

  return candidates.find((c) => filePaths.has(c));
}

export async function buildRepoGraph(repositoryId: string): Promise<RepoGraph> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT file_path, content FROM code_chunks WHERE repository_id = $1 ORDER BY file_path, start_line ASC`,
    [repositoryId]
  );

  const contentByFile = new Map<string, string>();
  for (const row of rows) {
    contentByFile.set(row.file_path, (contentByFile.get(row.file_path) ?? "") + "\n" + row.content);
  }

  const filePaths = new Set(contentByFile.keys());
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];
  const degree = new Map<string, number>();
  for (const f of filePaths) degree.set(f, 0);

  for (const [filePath, content] of contentByFile) {
    for (const spec of extractImportSpecs(content)) {
      const target = resolveImport(spec, filePath, filePaths);
      if (!target || target === filePath) continue;
      const key = [filePath, target].sort().join("::");
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push({ source: filePath, target });
      degree.set(filePath, (degree.get(filePath) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }
  }

  let keptFiles = [...filePaths];
  if (keptFiles.length > MAX_NODES) {
    keptFiles = keptFiles
      .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))
      .slice(0, MAX_NODES);
  }
  const kept = new Set(keptFiles);
  const finalEdges = edges.filter((e) => kept.has(e.source) && kept.has(e.target));

  const communityNames = [...new Set(keptFiles.map(communityOf))].sort();
  const colorOf = new Map(communityNames.map((name, i) => [name, PALETTE[i % PALETTE.length]]));

  const nodes: GraphNode[] = keptFiles.map((f) => ({
    id: f,
    label: f.split("/").pop() ?? f,
    community: communityOf(f),
  }));

  const communities: GraphCommunity[] = communityNames.map((name) => ({
    name,
    color: colorOf.get(name)!,
  }));

  return { nodes, edges: finalEdges, communities };
}
