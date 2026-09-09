-- RepoMind Phase 1 schema (trimmed from plan.md's full design: no directory/summary
-- graph tables yet, and chunk_type is currently always 'file_window' since chunking
-- is naive line-windowing, not AST-aware).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(255) UNIQUE NOT NULL,
    default_branch VARCHAR(100) DEFAULT 'main',
    commit_sha VARCHAR(40) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS code_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    language VARCHAR(50),
    chunk_type VARCHAR(50),
    start_line INT NOT NULL,
    end_line INT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1024),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS code_chunks_repo_idx ON code_chunks (repository_id);

CREATE INDEX IF NOT EXISTS code_chunks_embedding_idx ON code_chunks
USING hnsw (embedding vector_cosine_ops);
