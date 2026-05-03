-- AlterTable: add parentSessionId to Session
--
-- Tracks parent-child session hierarchy for supervisor-spawned fix agents.
-- When a supervisor guardian session spawns fix agent sessions, each fix
-- session stores the guardian session ID as its parentSessionId.
-- Nullable for backward compatibility; standalone sessions have NULL.

ALTER TABLE "Session" ADD COLUMN "parentSessionId" TEXT;
CREATE INDEX "Session_parentSessionId_idx" ON "Session"("parentSessionId");
