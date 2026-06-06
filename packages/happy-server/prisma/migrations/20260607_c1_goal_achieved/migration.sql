-- ADR-0022 C-1 — semantic exit: `goal_achieved` after N consecutive empty
-- analysis iterations.
--
-- Today's `no_new_actions` fires on the first iteration that returns zero
-- approvable actions — a noisy signal because a one-off analysis miss looks
-- identical to true convergence. The threshold column lets a loop demand N
-- consecutive empty iterations before exiting, with the new exit reason
-- `goal_achieved` reflecting that we waited for confirmation. Existing rows
-- default to 1 → behaviour unchanged; new loops created via startLoop are
-- assigned 2 in code so the upgrade is automatic.

ALTER TABLE "SupervisorLoop"
    ADD COLUMN "emptyIterationsToConfirm"   INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "SupervisorLoop"
    ADD COLUMN "consecutiveEmptyIterations" INTEGER NOT NULL DEFAULT 0;
