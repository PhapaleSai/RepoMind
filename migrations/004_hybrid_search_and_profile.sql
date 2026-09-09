-- Hybrid search (plan.md Phase 2): full-text column + GIN index alongside the existing
-- vector index, so retrieval can fuse dense (pgvector) and sparse (keyword) results.
ALTER TABLE code_chunks
  ADD COLUMN IF NOT EXISTS content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

CREATE INDEX IF NOT EXISTS code_chunks_tsv_idx ON code_chunks USING GIN (content_tsv);

-- Repo profile (plan.md Phase 3 diagram + Phase 5 onboarding/complexity): cached, since
-- generation is an LLM call and we don't want to redo it on every page load.
ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS profile jsonb,
  ADD COLUMN IF NOT EXISTS security_findings jsonb;
