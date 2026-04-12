-- DropIndex
DROP INDEX IF EXISTS "AgentRole_accountId_projectId_idx";

-- AlterTable: AgentMessage — add collaboration fields
ALTER TABLE "AgentMessage"
    ADD COLUMN IF NOT EXISTS "priority" TEXT DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS "relatedGoalId" TEXT,
    ADD COLUMN IF NOT EXISTS "relatedTaskId" TEXT;

-- AlterTable: Goal — add health tracking fields (Stage G)
ALTER TABLE "Goal"
    ADD COLUMN IF NOT EXISTS "blockedSince" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "healthScore" INTEGER,
    ADD COLUMN IF NOT EXISTS "layer" TEXT;

-- AlterTable: WorldSuggestion — add auto-accept audit and bucket fields
ALTER TABLE "WorldSuggestion"
    ADD COLUMN IF NOT EXISTS "acceptAudit" TEXT,
    ADD COLUMN IF NOT EXISTS "acceptSource" TEXT,
    ADD COLUMN IF NOT EXISTS "autoAcceptFailureDetail" TEXT,
    ADD COLUMN IF NOT EXISTS "autoAcceptReasonCode" TEXT,
    ADD COLUMN IF NOT EXISTS "autoAcceptStatus" TEXT,
    ADD COLUMN IF NOT EXISTS "bucket" TEXT NOT NULL DEFAULT 'next_step';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentMessage_projectId_relatedGoalId_idx" ON "AgentMessage"("projectId", "relatedGoalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentMessage_relatedTaskId_msgType_idx" ON "AgentMessage"("relatedTaskId", "msgType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentRole_accountId_projectId_enabled_idx" ON "AgentRole"("accountId", "projectId", "enabled");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Goal_projectId_healthScore_idx" ON "Goal"("projectId", "healthScore");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_goalId_status_idx" ON "Task"("goalId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorldSuggestion_projectId_bucket_idx" ON "WorldSuggestion"("projectId", "bucket");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorldSuggestion_projectId_relatedGoalId_idx" ON "WorldSuggestion"("projectId", "relatedGoalId");
