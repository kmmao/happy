-- Knowledge Base Phase 2: pgvector + relatedIds + embedding

-- Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add relatedIds column (JSON array of related entry IDs)
ALTER TABLE "ProjectKnowledge" ADD COLUMN IF NOT EXISTS "relatedIds" TEXT NOT NULL DEFAULT '[]';

-- Add embedding column (1536-dim vector for OpenAI text-embedding-3-small)
ALTER TABLE "ProjectKnowledge" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

-- Create HNSW index for cosine similarity search
-- HNSW is preferred over IVFFlat for small-to-medium datasets:
-- - No build-time data requirement (works on empty tables)
-- - Better recall at low row counts
-- - m=16, ef_construction=64 are pgvector defaults, good for <100K rows
CREATE INDEX IF NOT EXISTS "ProjectKnowledge_embedding_idx"
    ON "ProjectKnowledge"
    USING hnsw ("embedding" vector_cosine_ops);
