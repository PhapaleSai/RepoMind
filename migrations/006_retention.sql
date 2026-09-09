-- 24h data retention: Insforge's free tier caps DB size (500MB), so ingested repos that
-- aren't actively used get cleaned up rather than accumulating forever. Tracked separately
-- from updated_at (which reflects ingest bookkeeping) so retention is based on actual
-- usage (chat/profile access bumps this too, not just re-ingestion).
ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS repositories_last_accessed_idx ON repositories (last_accessed_at);
