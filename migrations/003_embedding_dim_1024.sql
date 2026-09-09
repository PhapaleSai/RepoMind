-- Switches embeddings to Cohere embed-english-v3.0 (1024 dims), replacing the Gemini
-- attempt (which hit a Google account-level 403 unrelated to code) and the earlier
-- Groq attempt (which never had an embeddings API to begin with).
-- Safe to run on an empty code_chunks table.

DROP INDEX IF EXISTS code_chunks_embedding_idx;

ALTER TABLE code_chunks
    ALTER COLUMN embedding TYPE vector(1024);

CREATE INDEX IF NOT EXISTS code_chunks_embedding_idx ON code_chunks
USING hnsw (embedding vector_cosine_ops);
