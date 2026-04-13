-- Add waitingDecisionId to Task for Decision wait mechanism
ALTER TABLE "Task"
    ADD COLUMN IF NOT EXISTS "waitingDecisionId" TEXT;

CREATE INDEX IF NOT EXISTS "Task_waitingDecisionId_idx" ON "Task"("waitingDecisionId");
