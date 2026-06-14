-- Phase 4 of the AgentLoop convergence (ADR-0022).
--
-- The Prisma model has been called `AgentLoop` since Phase 3a, but the
-- physical Postgres table still carried the historical name
-- `SupervisorLoop` via `@@map`. Phase 4 drops the alias and aligns the
-- physical layout with the model name.
--
-- Operations:
--   1. Rename the table.
--   2. Rename the primary-key constraint to match the new table prefix.
--   3. Rename every named index so subsequent Prisma diffs stay quiet.
--   4. Rename the outgoing foreign-key constraint on `projectId`.
--   5. Foreign keys pointing INTO this table (SupervisorRun.loopId) keep
--      their own constraint names because those are tied to the
--      *referencing* table and survive a renamed referent transparently.

ALTER TABLE "SupervisorLoop" RENAME TO "AgentLoop";

ALTER INDEX "SupervisorLoop_pkey" RENAME TO "AgentLoop_pkey";

ALTER INDEX "SupervisorLoop_projectId_idx"
    RENAME TO "AgentLoop_projectId_idx";
ALTER INDEX "SupervisorLoop_projectId_status_idx"
    RENAME TO "AgentLoop_projectId_status_idx";
ALTER INDEX "SupervisorLoop_accountId_status_idx"
    RENAME TO "AgentLoop_accountId_status_idx";
ALTER INDEX "SupervisorLoop_role_status_idx"
    RENAME TO "AgentLoop_role_status_idx";
ALTER INDEX "SupervisorLoop_role_enabled_nextRunAt_idx"
    RENAME TO "AgentLoop_role_enabled_nextRunAt_idx";

ALTER TABLE "AgentLoop"
    RENAME CONSTRAINT "SupervisorLoop_projectId_fkey"
    TO "AgentLoop_projectId_fkey";
