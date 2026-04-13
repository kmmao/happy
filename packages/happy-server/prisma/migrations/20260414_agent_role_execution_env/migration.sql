-- Migration: AgentRole execution environment fields
-- Adds agentType and modelOverride to AgentRole to support per-role agent selection

ALTER TABLE "AgentRole"
    ADD COLUMN IF NOT EXISTS "agentType"     TEXT,
    ADD COLUMN IF NOT EXISTS "modelOverride" TEXT;
