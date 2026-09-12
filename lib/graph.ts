import { getPool } from "./db";
import { isAstSupported, extractJsSymbolsAndImports } from "./ast";

// Graphify-style knowledge graph (user request: "like graphify graph... dots should show how
// function etc is connected"): a real, deterministic node-link graph built straight from the
// ingested chunks already in Postgres — no LLM call, so it's free, instant, and never
// hallucinated (unlike the Mermaid diagrams which the model invents). Two node kinds:
//   - "file" nodes, connected by real import/require edges between files.
//   - "symbol" nodes (functions/classes detected in each file), connected to their own file,
//     and to OTHER files that textually reference them — an approximate cross-file call graph,
//     good enough to see "this function is used over there" without a full language parser.
//
// Symbol/import extraction itself is AST-based for JS/TS/JSX/TSX (lib/ast.ts, via
// @babel/parser) — real parsing instead of regex guessing, so arrow functions, generics,
// decorators, and JSX no longer trip it up. Every other ingested language (Python, Go, Java,
// ...) still uses the regex heuristics below, as does any JS/TS file that fails to parse
// (syntax errors, exotic dialects) — AST extraction throws rather than guessing wrong, so
// those fall back rather than silently returning nothing.

export type NodeKind = "file" | "symbol";

export interface GraphNode {
  id: string;
  label: string;
  community: string;
  kind: NodeKind;
  file: string;
  symbolKind?: "function" | "class";
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphCommunity {
  name: string;
  color: string;
}

export interface Hotspot {
  file: string;
  degree: number;
  symbolCount: number;
}

export interface RepoGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: GraphCommunity[];
  hotspots: Hotspot[];
}

// A repo with thousands of files+symbols would make the O(n^2) force layout unreadable and
// slow — cap total nodes and prioritize the most-connected files, same tradeoff graphify's own
// "top N nodes" view makes.
const MAX_FILE_NODES = 90;
const MAX_SYMBOLS_PER_FILE = 10;
const MIN_SYMBOL_NAME_LEN = 3;
const MAX_USES_PER_IMPORT = 4;

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

const SYMBOL_PATTERNS: { re: RegExp; kind: "function" | "class" }[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/gm, kind: "function" },
  { re: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/gm, kind: "class" },
  { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?[^=]*?\)?\s*=>/gm, kind: "function" },
  { re: /^\s*def\s+([A-Za-z_]\w*)\s*\(/gm, kind: "function" },
  { re: /^\s*class\s+([A-Za-z_]\w*)\s*[:(]/gm, kind: "class" },
];

interface RawSymbol {
  name: string;
  kind: "function" | "class";
}

function extractSymbols(content: string): RawSymbol[] {
  const seen = new Set<string>();
  const symbols: RawSymbol[] = [];
  for (const { re, kind } of SYMBOL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const name = m[1];
      if (name.length < MIN_SYMBOL_NAME_LEN) continue;
      const key = `${kind}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({ name, kind });
    }
  }
  return symbols;
}

function extractImportSpecs(content: string): string[] {
  const specs: string[] = [];
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) specs.push(m[1]);
  }
  return specs;
}

interface FileData {
  symbols: RawSymbol[];
  importSpecs: string[];
}

function extractFileData(filePath: string, content: string): FileData {
  if (isAstSupported(filePath)) {
    try {
      const { symbols, importSpecs } = extractJsSymbolsAndImports(content, filePath);
      return { symbols, importSpecs };
    } catch {
      // Fall through to the regex heuristics below — a parse error (syntax the file's real
      // toolchain accepts but this parser config doesn't, e.g. Flow-only syntax, or genuinely
      // broken code) shouldn't mean the file gets no graph representation at all.
    }
  }
  return { symbols: extractSymbols(content), importSpecs: extractImportSpecs(content) };
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

  // One parse per file, reused for both import edges and symbol nodes below — avoids running
  // the AST parser (or regexes) twice over the same content.
  const dataByFile = new Map<string, FileData>();
  for (const [filePath, content] of contentByFile) {
    dataByFile.set(filePath, extractFileData(filePath, content));
  }

  // Directed file->file import edges (kept directional so we know who could be *using*
  // whom, which is what makes the symbol-level "uses" edges below meaningful).
  const importEdges: GraphEdge[] = [];
  const degree = new Map<string, number>();
  for (const f of filePaths) degree.set(f, 0);

  for (const [filePath, data] of dataByFile) {
    for (const spec of data.importSpecs) {
      const target = resolveImport(spec, filePath, filePaths);
      if (!target || target === filePath) continue;
      importEdges.push({ source: filePath, target });
      degree.set(filePath, (degree.get(filePath) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }
  }

  let keptFiles = [...filePaths];
  if (keptFiles.length > MAX_FILE_NODES) {
    keptFiles = keptFiles
      .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))
      .slice(0, MAX_FILE_NODES);
  }
  const kept = new Set(keptFiles);
  const finalImportEdges = importEdges.filter((e) => kept.has(e.source) && kept.has(e.target));

  const communityNames = [...new Set(keptFiles.map(communityOf))].sort();
  const colorOf = new Map(communityNames.map((name, i) => [name, PALETTE[i % PALETTE.length]]));

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [...finalImportEdges];

  const symbolsByFile = new Map<string, RawSymbol[]>();
  for (const f of keptFiles) {
    symbolsByFile.set(f, (dataByFile.get(f)?.symbols ?? []).slice(0, MAX_SYMBOLS_PER_FILE));
  }

  for (const f of keptFiles) {
    nodes.push({ id: f, label: f.split("/").pop() ?? f, community: communityOf(f), kind: "file", file: f });

    for (const sym of symbolsByFile.get(f) ?? []) {
      const symbolId = `${f}#${sym.name}`;
      nodes.push({
        id: symbolId,
        label: sym.name,
        community: communityOf(f),
        kind: "symbol",
        file: f,
        symbolKind: sym.kind,
      });
      // "contains" edge: pins the symbol dot near its own file in the force layout.
      edges.push({ source: f, target: symbolId });
    }
  }

  // Approximate cross-file call graph: for every real import A -> B, check whether A's source
  // textually references any of B's symbol names (whole-word match) — if so, draw an edge from
  // A straight to that specific symbol dot in B, instead of just the coarse file-level edge.
  for (const imp of finalImportEdges) {
    const importerContent = contentByFile.get(imp.source) ?? "";
    const targetSymbols = symbolsByFile.get(imp.target) ?? [];
    let used = 0;
    for (const sym of targetSymbols) {
      if (used >= MAX_USES_PER_IMPORT) break;
      const wordRe = new RegExp(`\\b${sym.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (wordRe.test(importerContent)) {
        edges.push({ source: imp.source, target: `${imp.target}#${sym.name}` });
        used++;
      }
    }
  }

  const communities: GraphCommunity[] = communityNames.map((name) => ({
    name,
    color: colorOf.get(name)!,
  }));

  // Hotspots: files with the most import fan-in/out — a simple, real signal for "this file
  // is load-bearing, be careful changing it" without needing any LLM judgment call.
  const hotspots: Hotspot[] = keptFiles
    .map((f) => ({ file: f, degree: degree.get(f) ?? 0, symbolCount: (symbolsByFile.get(f) ?? []).length }))
    .filter((h) => h.degree > 0)
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 8);

  return { nodes, edges, communities, hotspots };
}
