-- ADR-0022 D-1 follow-up — make the auto-loop debounce window configurable
-- per project, and let users reset it on demand via a dedicated endpoint.
--
-- The previous commit hardcoded the debounce at 24h in supervisorAutoLoop.ts.
-- That's the right default for production but useless for testing, and it
-- locks users out of re-triggering an auto-loop when a real incident requires
-- back-to-back attention. Storing the window per project (in minutes) keeps
-- the engine logic centralised; the existing lastAutoLoopStartedAt column
-- remains the per-project cooldown clock and is cleared by the reset endpoint.
--
-- Default 1440 minutes = 24 hours, matching the prior hardcoded behaviour for
-- every existing project row.

ALTER TABLE "Project"
    ADD COLUMN "autoLoopDebounceMinutes" INTEGER NOT NULL DEFAULT 1440;
