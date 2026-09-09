import { getPool } from "./db";
import { touchRepositoryAccess } from "./cleanup";

export class AccessDeniedError extends Error {
  constructor(message = "You don't have access to this repository") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

// Public repos: no check needed. Private repos: the ingest path already proved access
// once (fetchRepoSnapshot/fetchLatestCommit fail for an unauthorized token), but chat
// and profile generation take a bare repositoryId with no inherent auth — without this,
// anyone who ever obtained that UUID could keep querying a private repo's content
// forever with no GitHub auth check. Re-verify live against GitHub on every such call.
//
// Also doubles as the "this repo is still in use" signal for 24h data retention
// (see lib/cleanup.ts) — every chat/profile call bumps last_accessed_at, so a repo
// someone keeps coming back to doesn't get swept just because it's a day old.
export async function assertRepoAccess(repositoryId: string, accessToken?: string): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT full_name, is_private FROM repositories WHERE id = $1`, [repositoryId]);
  const repo = rows[0];
  if (!repo) {
    throw new AccessDeniedError("This repository is no longer indexed (auto-removed after 24h of inactivity) — re-ingest it to continue.");
  }

  if (repo.is_private) {
    if (!accessToken) {
      throw new AccessDeniedError("This is a private repository — connect GitHub to access it");
    }
    const res = await fetch(`https://api.github.com/repos/${repo.full_name}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      throw new AccessDeniedError("Your GitHub account doesn't have access to this repository");
    }
  }

  await touchRepositoryAccess(repositoryId);
}
