-- Session-scoped turn TTL counters for knowledge entries.
-- Each entry injected into a session has a lifespan measured in user turns.
-- Hitting (entry referenced) increments turnsRemaining up to maxTurns; missing decrements.
-- When turnsRemaining <= 0, hotStatus becomes "evicted" and the entry skips future injections.

ALTER TABLE "KnowledgeAccess"
    ADD COLUMN IF NOT EXISTS "initialTurns"   INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS "maxTurns"       INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS "turnsRemaining" INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS "hitCount"       INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "hotStatus"      TEXT    NOT NULL DEFAULT 'hot',
    ADD COLUMN IF NOT EXISTS "lastHitAt"      TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "KnowledgeAccess_sessionId_hotStatus_idx"
    ON "KnowledgeAccess"("sessionId", "hotStatus");
