import { getPool } from "./db";

// Free-tier data retention: repositories (and their code_chunks, via ON DELETE CASCADE)
// get removed 24h after they were last actually used (ingested, chatted with, or had a
// profile generated) — not just 24h after ingestion, so a repo someone keeps chatting
// with daily doesn't vanish mid-use. Called both from a daily Vercel Cron job and
// opportunistically on every ingest, so cleanup still happens even if the cron
// misfires or isn't configured.
const RETENTION_HOURS = 24;

export async function cleanupStaleRepositories(): Promise<number> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `DELETE FROM repositories WHERE last_accessed_at < now() - interval '${RETENTION_HOURS} hours'`
  );
  return rowCount ?? 0;
}

export async function touchRepositoryAccess(repositoryId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE repositories SET last_accessed_at = now() WHERE id = $1`, [repositoryId]);
}
