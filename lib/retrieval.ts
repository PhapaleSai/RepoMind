import { getPool } from "./db";

export interface CodeChunkMatch {
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  content: string;
  distance: number;
}

interface RawRow {
  id: string;
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
  content: string;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// Hybrid search (plan.md Phase 2): dense vector similarity (pgvector cosine distance)
// fused with sparse keyword search (Postgres full-text, a BM25-like ts_rank) via
// reciprocal rank fusion. Vector search alone misses exact identifier/keyword matches
// (e.g. a literal function or route name); keyword search alone misses paraphrases.
// RRF (k=60, the standard default from the original TREC paper) needs no score
// normalization between the two very different scales (cosine distance vs ts_rank).
const RRF_K = 60;
const CANDIDATE_POOL = 25;

async function vectorSearch(
  repositoryId: string,
  queryEmbedding: number[],
  limit: number
): Promise<RawRow[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, file_path, language, start_line, end_line, content
     FROM code_chunks
     WHERE repository_id = $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [toVectorLiteral(queryEmbedding), repositoryId, limit]
  );
  return rows;
}

async function keywordSearch(repositoryId: string, queryText: string, limit: number): Promise<RawRow[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, file_path, language, start_line, end_line, content
     FROM code_chunks
     WHERE repository_id = $1 AND content_tsv @@ plainto_tsquery('english', $2)
     ORDER BY ts_rank(content_tsv, plainto_tsquery('english', $2)) DESC
     LIMIT $3`,
    [repositoryId, queryText, limit]
  );
  return rows;
}

export async function searchCodeChunks(
  repositoryId: string,
  queryEmbedding: number[],
  queryText: string,
  limit = 8
): Promise<CodeChunkMatch[]> {
  const [vectorRows, keywordRows] = await Promise.all([
    vectorSearch(repositoryId, queryEmbedding, CANDIDATE_POOL),
    keywordSearch(repositoryId, queryText, CANDIDATE_POOL),
  ]);

  const rrfScore = new Map<string, number>();
  const rowById = new Map<string, RawRow>();

  vectorRows.forEach((row, rank) => {
    rowById.set(row.id, row);
    rrfScore.set(row.id, (rrfScore.get(row.id) ?? 0) + 1 / (RRF_K + rank + 1));
  });
  keywordRows.forEach((row, rank) => {
    rowById.set(row.id, row);
    rrfScore.set(row.id, (rrfScore.get(row.id) ?? 0) + 1 / (RRF_K + rank + 1));
  });

  const ranked = [...rrfScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);

  return ranked.map(([id, score]) => {
    const row = rowById.get(id)!;
    return {
      filePath: row.file_path,
      language: row.language,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      distance: 1 - score, // kept as "distance" for API shape compatibility; lower = better
    };
  });
}
