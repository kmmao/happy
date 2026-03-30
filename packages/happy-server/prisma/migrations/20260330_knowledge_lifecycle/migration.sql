-- Knowledge Lifecycle: Graph Relations + Decay Fields
-- Phase A: KnowledgeRelation table (replaces relatedIds JSON array)
-- Phase B: lastAccessedAt + accessCount for decay/archive

-- ─── Phase A: KnowledgeRelation table ───

CREATE TABLE "KnowledgeRelation" (
    "id" TEXT NOT NULL,
    "fromEntryId" TEXT NOT NULL,
    "toEntryId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeRelation_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one relation type per pair
CREATE UNIQUE INDEX "KnowledgeRelation_fromEntryId_toEntryId_relationType_key"
    ON "KnowledgeRelation"("fromEntryId", "toEntryId", "relationType");

CREATE INDEX "KnowledgeRelation_fromEntryId_idx" ON "KnowledgeRelation"("fromEntryId");
CREATE INDEX "KnowledgeRelation_toEntryId_idx" ON "KnowledgeRelation"("toEntryId");
CREATE INDEX "KnowledgeRelation_relationType_idx" ON "KnowledgeRelation"("relationType");

-- Foreign keys with CASCADE delete
ALTER TABLE "KnowledgeRelation"
    ADD CONSTRAINT "KnowledgeRelation_fromEntryId_fkey"
    FOREIGN KEY ("fromEntryId") REFERENCES "ProjectKnowledge"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeRelation"
    ADD CONSTRAINT "KnowledgeRelation_toEntryId_fkey"
    FOREIGN KEY ("toEntryId") REFERENCES "ProjectKnowledge"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Phase B: Lifecycle fields on ProjectKnowledge ───

ALTER TABLE "ProjectKnowledge" ADD COLUMN IF NOT EXISTS "lastAccessedAt" TIMESTAMP(3);
ALTER TABLE "ProjectKnowledge" ADD COLUMN IF NOT EXISTS "accessCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "ProjectKnowledge_projectId_status_lastAccessedAt_idx"
    ON "ProjectKnowledge"("projectId", "status", "lastAccessedAt");

-- ─── Data migration: relatedIds JSON → KnowledgeRelation rows ───
-- Idempotent: ON CONFLICT DO NOTHING

DO $$
DECLARE
    r RECORD;
    related_id TEXT;
    arr JSONB;
BEGIN
    FOR r IN
        SELECT pk.id, pk."relatedIds"
        FROM "ProjectKnowledge" pk
        WHERE pk."relatedIds" IS NOT NULL
          AND pk."relatedIds" != '[]'
          AND pk."relatedIds" != ''
    LOOP
        BEGIN
            arr := r."relatedIds"::jsonb;
        EXCEPTION WHEN OTHERS THEN
            CONTINUE;
        END;

        IF jsonb_typeof(arr) != 'array' THEN
            CONTINUE;
        END IF;

        FOR related_id IN SELECT jsonb_array_elements_text(arr)
        LOOP
            -- Only insert if target entry exists (LEFT JOIN filter)
            INSERT INTO "KnowledgeRelation" ("id", "fromEntryId", "toEntryId", "relationType", "createdAt")
            SELECT
                'migr_' || substr(md5(r.id || related_id || 'related'), 1, 20),
                r.id,
                related_id,
                'related',
                NOW()
            FROM "ProjectKnowledge" target
            WHERE target.id = related_id
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;
