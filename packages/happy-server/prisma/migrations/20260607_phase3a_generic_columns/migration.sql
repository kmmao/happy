-- Phase 3a of the AgentLoop convergence (ADR-0022).
--
-- Adds the 10 columns needed for role='generic' AgentLoop definitions to live
-- on the server. All columns are nullable (or carry a safe default) so the
-- existing supervisor-role rows are unaffected. Phase 3b will land the CLI
-- pipeline that reads these columns on daemon boot.
--
-- Naming note: CLI-side AgentLoopDefinition has its own roleId/roleName/
-- roleType (user-facing agent persona) which collides with the top-level
-- `role` discriminator (supervisor vs generic). To avoid the collision, those
-- three fields live inside the genericConfig JSON blob rather than as
-- dedicated columns.

ALTER TABLE "SupervisorLoop" ADD COLUMN "prompt" TEXT;
ALTER TABLE "SupervisorLoop" ADD COLUMN "directory" TEXT;
ALTER TABLE "SupervisorLoop" ADD COLUMN "agent" TEXT;
ALTER TABLE "SupervisorLoop" ADD COLUMN "intervalMs" INTEGER;
ALTER TABLE "SupervisorLoop" ADD COLUMN "cronExpression" TEXT;
ALTER TABLE "SupervisorLoop" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "SupervisorLoop" ADD COLUMN "nextRunAt" BIGINT;
ALTER TABLE "SupervisorLoop" ADD COLUMN "continuityKey" TEXT;
ALTER TABLE "SupervisorLoop" ADD COLUMN "iteration" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SupervisorLoop" ADD COLUMN "genericConfig" JSONB;

-- Scheduler hot path: find every enabled generic loop whose nextRunAt has
-- elapsed, in one index scan.
CREATE INDEX "SupervisorLoop_role_enabled_nextRunAt_idx"
    ON "SupervisorLoop"("role", "enabled", "nextRunAt");
