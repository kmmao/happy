-- ADR-0022 D-1 — autonomous loop discovery.
--
-- Adds two opt-in columns to Project. When `autoLoopHealthThreshold` is set,
-- a SupervisorRun completion above that threshold (lower healthScore = better)
-- auto-starts a supervisor-role AgentLoop. `lastAutoLoopStartedAt` enforces a
-- 24h debounce so a noisy project doesn't spawn loops repeatedly.
-- Default null on both → feature is dormant for every existing project.

ALTER TABLE "Project" ADD COLUMN "autoLoopHealthThreshold" INTEGER;
ALTER TABLE "Project" ADD COLUMN "lastAutoLoopStartedAt"   TIMESTAMP(3);
