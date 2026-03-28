-- Change embedding dimension from 1536 to 768 for Ollama nomic-embed-text compatibility
-- OpenAI text-embedding-3-small also supports 768 via the dimensions parameter

-- Drop existing HNSW index (dimension-specific)
DROP INDEX IF EXISTS "ProjectKnowledge_embedding_idx";

-- Clear existing embeddings (wrong dimension, need re-embedding)
UPDATE "ProjectKnowledge" SET "embedding" = NULL WHERE "embedding" IS NOT NULL;

-- Alter column to new dimension
ALTER TABLE "ProjectKnowledge" ALTER COLUMN "embedding" TYPE vector(768);

-- Recreate HNSW index with new dimension
CREATE INDEX IF NOT EXISTS "ProjectKnowledge_embedding_idx"
    ON "ProjectKnowledge"
    USING hnsw ("embedding" vector_cosine_ops);
