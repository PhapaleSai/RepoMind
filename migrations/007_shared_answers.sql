-- Shareable answer links: a user can publish one Q&A turn to a public, read-only URL without
-- needing an account system — just a random id. Deliberately separate from `repositories`
-- (and not subject to the 24h retention sweep) since a shared link should keep working even
-- after the source repo's ingested data has been cleaned up.
CREATE TABLE IF NOT EXISTS shared_answers (
  id TEXT PRIMARY KEY,
  repo_full_name TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL DEFAULT 'technical',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
