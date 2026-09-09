import { Pool, PoolClient } from "pg";
import { getPool } from "./db";
import {
  fetchRepoSnapshot,
  fetchRepoDiff,
  fetchLatestCommit,
  parseGitHubUrl,
  type FetchedFile,
} from "./github";
import { chunkFiles } from "./chunk";
import { embedTexts } from "./embeddings";
import { scanFilesForSecrets, mergeSecurityFindings, type SecurityFinding } from "./security";
import { cleanupStaleRepositories } from "./cleanup";

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export type IngestMode = "full" | "incremental" | "unchanged";

export interface IngestResult {
  repositoryId: string;
  fileCount: number;
  chunkCount: number;
  commitSha: string;
  mode: IngestMode;
  filesChanged: number;
  securityFindings: SecurityFinding[];
}

async function updateSecurityFindings(
  pool: Pool,
  repositoryId: string,
  touchedFiles: FetchedFile[],
  removedPaths: string[]
): Promise<SecurityFinding[]> {
  const { rows } = await pool.query(`SELECT security_findings FROM repositories WHERE id = $1`, [repositoryId]);
  const existing = rows[0]?.security_findings ?? null;
  const touchedFindings = scanFilesForSecrets(touchedFiles);
  const touchedPaths = touchedFiles.map((f) => f.path);
  const merged = mergeSecurityFindings(existing, touchedFindings, touchedPaths, removedPaths);

  await pool.query(`UPDATE repositories SET security_findings = $1 WHERE id = $2`, [JSON.stringify(merged), repositoryId]);
  return Object.values(merged).flat();
}

const INSERT_BATCH_SIZE = 50;

async function insertChunksForFiles(
  client: PoolClient,
  repositoryId: string,
  files: FetchedFile[]
): Promise<number> {
  const chunks = chunkFiles(files);
  if (chunks.length === 0) return 0;
  const embeddings = await embedTexts(chunks.map((c) => c.content));

  for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
    const batch = chunks.slice(i, i + INSERT_BATCH_SIZE);
    const values: unknown[] = [];
    const rows = batch.map((chunk, j) => {
      const embedding = embeddings[i + j];
      const base = j * 7;
      values.push(
        repositoryId,
        chunk.filePath,
        chunk.language,
        chunk.startLine,
        chunk.endLine,
        chunk.content,
        toVectorLiteral(embedding)
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, 'file_window', $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::vector)`;
    });

    await client.query(
      `INSERT INTO code_chunks
         (repository_id, file_path, language, chunk_type, start_line, end_line, content, embedding)
       VALUES ${rows.join(", ")}`,
      values
    );
  }
  return chunks.length;
}

async function getTotals(pool: Pool, repositoryId: string): Promise<{ fileCount: number; chunkCount: number }> {
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT file_path)::int AS file_count, COUNT(*)::int AS chunk_count
     FROM code_chunks WHERE repository_id = $1`,
    [repositoryId]
  );
  return { fileCount: rows[0].file_count, chunkCount: rows[0].chunk_count };
}

export async function ingestRepository(repoUrl: string, accessToken?: string): Promise<IngestResult> {
  const ref = parseGitHubUrl(repoUrl);
  const pool = getPool();

  // Opportunistic 24h retention sweep (see lib/cleanup.ts) — runs on every ingest so
  // storage stays bounded even if the daily cron job (app/api/cron/cleanup) misfires or
  // isn't configured on a given deployment.
  try {
    await cleanupStaleRepositories();
  } catch {
    // best-effort — never block ingestion on a cleanup failure
  }

  const existing = await pool.query(
    `SELECT id, commit_sha FROM repositories WHERE full_name = $1`,
    [`${ref.owner}/${ref.repo}`]
  );

  // Incremental re-ingest (plan.md Phase 5): if the repo was already indexed, check the
  // latest commit cheaply first, then diff against the previously-indexed commit via
  // GitHub's compare API so an unchanged repo costs one API call and a changed repo only
  // re-embeds the files that actually changed, instead of the whole tree every time.
  if (existing.rows.length > 0) {
    const repositoryId = existing.rows[0].id;
    const previousSha = existing.rows[0].commit_sha;
    const { commitSha } = await fetchLatestCommit(ref, accessToken);

    if (commitSha === previousSha) {
      await pool.query(`UPDATE repositories SET last_accessed_at = now() WHERE id = $1`, [repositoryId]);
      const totals = await getTotals(pool, repositoryId);
      const { rows: findingRows } = await pool.query(`SELECT security_findings FROM repositories WHERE id = $1`, [repositoryId]);
      const securityFindings = Object.values(findingRows[0]?.security_findings ?? {}).flat() as SecurityFinding[];
      return { repositoryId, ...totals, commitSha, mode: "unchanged", filesChanged: 0, securityFindings };
    }

    const diff = await fetchRepoDiff(ref, previousSha, commitSha, accessToken);

    if (!diff.fallbackToFull) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`UPDATE repositories SET status = 'indexing', updated_at = now(), last_accessed_at = now() WHERE id = $1`, [repositoryId]);

        const touchedPaths = [...diff.removedPaths, ...diff.changed.map((f) => f.path)];
        if (touchedPaths.length > 0) {
          await client.query(
            `DELETE FROM code_chunks WHERE repository_id = $1 AND file_path = ANY($2::text[])`,
            [repositoryId, touchedPaths]
          );
        }
        await insertChunksForFiles(client, repositoryId, diff.changed);

        await client.query(
          `UPDATE repositories SET commit_sha = $1, status = 'ready', updated_at = now(), last_accessed_at = now() WHERE id = $2`,
          [commitSha, repositoryId]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        await pool.query(`UPDATE repositories SET status = 'error', updated_at = now() WHERE id = $1`, [repositoryId]);
        throw err;
      } finally {
        client.release();
      }

      const totals = await getTotals(pool, repositoryId);
      const securityFindings = await updateSecurityFindings(pool, repositoryId, diff.changed, diff.removedPaths);
      return { repositoryId, ...totals, commitSha, mode: "incremental", filesChanged: touchedPathsCount(diff), securityFindings };
    }
    // fallthrough: diff.fallbackToFull — do a full re-ingest below using this repositoryId
    return fullIngest(pool, ref, repositoryId, accessToken);
  }

  return fullIngest(pool, ref, null, accessToken);
}

function touchedPathsCount(diff: { removedPaths: string[]; changed: FetchedFile[] }): number {
  return new Set([...diff.removedPaths, ...diff.changed.map((f) => f.path)]).size;
}

async function fullIngest(
  pool: Pool,
  ref: { owner: string; repo: string },
  existingRepositoryId: string | null,
  accessToken?: string
): Promise<IngestResult> {
  const snapshot = await fetchRepoSnapshot(ref, accessToken);

  let repositoryId: string;
  if (existingRepositoryId) {
    repositoryId = existingRepositoryId;
    await pool.query(
      `UPDATE repositories SET commit_sha = $1, status = 'indexing', is_private = $2, updated_at = now(), last_accessed_at = now() WHERE id = $3`,
      [snapshot.commitSha, snapshot.isPrivate, repositoryId]
    );
    await pool.query(`DELETE FROM code_chunks WHERE repository_id = $1`, [repositoryId]);
  } else {
    const inserted = await pool.query(
      `INSERT INTO repositories (full_name, default_branch, commit_sha, is_private, status)
       VALUES ($1, $2, $3, $4, 'indexing') RETURNING id`,
      [`${ref.owner}/${ref.repo}`, snapshot.defaultBranch, snapshot.commitSha, snapshot.isPrivate]
    );
    repositoryId = inserted.rows[0].id;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertChunksForFiles(client, repositoryId, snapshot.files);
    await client.query(`UPDATE repositories SET status = 'ready', updated_at = now(), last_accessed_at = now() WHERE id = $1`, [repositoryId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    await pool.query(`UPDATE repositories SET status = 'error', updated_at = now() WHERE id = $1`, [repositoryId]);
    throw err;
  } finally {
    client.release();
  }

  const totals = await getTotals(pool, repositoryId);
  const securityFindings = await updateSecurityFindings(pool, repositoryId, snapshot.files, []);
  return {
    repositoryId,
    ...totals,
    commitSha: snapshot.commitSha,
    mode: "full",
    filesChanged: snapshot.files.length,
    securityFindings,
  };
}
