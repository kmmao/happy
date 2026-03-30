-- Project-level knowledge base configuration
-- null = inherit hardcoded defaults
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "knowledgeConfig" TEXT;
