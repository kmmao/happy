-- Delete duplicate KnowledgeAccess rows, keeping only the earliest per (sessionId, knowledgeId).
DELETE FROM "KnowledgeAccess"
WHERE id NOT IN (
    SELECT DISTINCT ON ("sessionId", "knowledgeId") id
    FROM "KnowledgeAccess"
    ORDER BY "sessionId", "knowledgeId", "at" ASC
);

-- Drop the old sessionId index (replaced by unique constraint which auto-creates an index)
DROP INDEX "KnowledgeAccess_sessionId_idx";

-- Add unique constraint on (sessionId, knowledgeId) so skipDuplicates actually works
CREATE UNIQUE INDEX "KnowledgeAccess_sessionId_knowledgeId_key" ON "KnowledgeAccess"("sessionId", "knowledgeId");
