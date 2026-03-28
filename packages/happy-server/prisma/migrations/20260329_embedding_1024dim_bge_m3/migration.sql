-- Switch embedding model from nomic-embed-text (768-dim) to bge-m3 (1024-dim)
-- bge-m3 has superior multilingual (Chinese+English) semantic capabilities

-- Drop existing HNSW index (dimension-specific)
DROP INDEX IF EXISTS "ProjectKnowledge_embedding_idx";

-- Clear existing embeddings (incompatible dimension, need re-embedding)
UPDATE "ProjectKnowledge" SET "embedding" = NULL WHERE "embedding" IS NOT NULL;

-- Alter column to new dimension
ALTER TABLE "ProjectKnowledge" ALTER COLUMN "embedding" TYPE vector(1024);

-- Recreate HNSW index with new dimension
CREATE INDEX IF NOT EXISTS "ProjectKnowledge_embedding_idx"
    ON "ProjectKnowledge"
    USING hnsw ("embedding" vector_cosine_ops);
