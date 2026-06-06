-- Phase 2 of the AgentLoop convergence (ADR-0022).
--
-- The Prisma model `SupervisorLoop` was renamed to `AgentLoop` in
-- schema.prisma, but `@@map("SupervisorLoop")` keeps the physical table name
-- unchanged. The only DDL this phase needs is the new `role` discriminator
-- column and an index for role-filtered range queries. The column default
-- 'supervisor' backfills every existing row, so no data migration runs.
--
-- Phase 4 will drop the @@map and rename the physical table once CLI-side
-- AgentLoops (role='generic') also land here.

ALTER TABLE "SupervisorLoop" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'supervisor';

CREATE INDEX "SupervisorLoop_role_status_idx" ON "SupervisorLoop"("role", "status");
