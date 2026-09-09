-- Switches embeddings from OpenAI text-embedding-3-small (1536 dims) to Groq's
-- nomic-embed-text-v1_5 (768 dims), so one Groq key covers chat + embeddings.
-- Safe to run even if code_chunks is empty (typical right after 001_init.sql).

DROP INDEX IF EXISTS code_chunks_embedding_idx;

ALTER TABLE code_chunks
    ALTER COLUMN embedding TYPE vector(768);

CREATE INDEX IF NOT EXISTS code_chunks_embedding_idx ON code_chunks
USING hnsw (embedding vector_cosine_ops);
