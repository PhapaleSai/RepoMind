import type { FetchedFile } from "./github";

// Phase 1 uses naive line-window chunking, not AST-aware chunking.
// Line numbers are preserved so citations still point at real file:line ranges;
// tree-sitter-based boundary-aligned chunking is a Phase 2 upgrade (see plan.md).
const CHUNK_LINES = 120;
const OVERLAP_LINES = 15;

export interface CodeChunk {
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  content: string;
}

function languageForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
    ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".rb": "ruby",
    ".php": "php", ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp", ".cs": "csharp",
    ".swift": "swift", ".kt": "kotlin", ".scala": "scala", ".sql": "sql", ".md": "markdown",
    ".json": "json", ".yml": "yaml", ".yaml": "yaml",
  };
  return map[ext] ?? "text";
}

export function chunkFile(file: FetchedFile): CodeChunk[] {
  const lines = file.content.split("\n");
  const language = languageForPath(file.path);

  if (lines.length <= CHUNK_LINES) {
    return [{
      filePath: file.path,
      language,
      startLine: 1,
      endLine: lines.length,
      content: file.content,
    }];
  }

  const chunks: CodeChunk[] = [];
  let start = 0;
  while (start < lines.length) {
    const end = Math.min(start + CHUNK_LINES, lines.length);
    chunks.push({
      filePath: file.path,
      language,
      startLine: start + 1,
      endLine: end,
      content: lines.slice(start, end).join("\n"),
    });
    if (end === lines.length) break;
    start = end - OVERLAP_LINES;
  }
  return chunks;
}

export function chunkFiles(files: FetchedFile[]): CodeChunk[] {
  return files.flatMap(chunkFile);
}
