-- AlterTable: add profileId to Task / TriggerSchedule / WebhookTrigger
--
-- Profile binding introduced by wire 0.14.0. Value references a business key
-- (built-in id like "anthropic" or AiBackendProfile.profileKey under the same
-- account). Nullable for backward compatibility; application layer enforces
-- presence on new records. NOT NULL constraint is a follow-up migration
-- after all legacy rows have been backfilled.

ALTER TABLE "Task" ADD COLUMN "profileId" TEXT;
CREATE INDEX "Task_accountId_profileId_idx" ON "Task"("accountId", "profileId");

ALTER TABLE "TriggerSchedule" ADD COLUMN "profileId" TEXT;
CREATE INDEX "TriggerSchedule_accountId_profileId_idx" ON "TriggerSchedule"("accountId", "profileId");

ALTER TABLE "WebhookTrigger" ADD COLUMN "profileId" TEXT;
CREATE INDEX "WebhookTrigger_accountId_profileId_idx" ON "WebhookTrigger"("accountId", "profileId");
