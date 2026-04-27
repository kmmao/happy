-- AlterTable: add profileId to WebhookRoute
--
-- Profile binding for the auto-fix issue webhook path (WebhookRoute).
-- Allows operators to configure which AI backend profile to use when
-- a GitHub/Gitea issue label triggers a session spawn. Nullable for
-- backward compatibility; existing routes default to the project profile
-- or built-in default.

ALTER TABLE "WebhookRoute" ADD COLUMN "profileId" TEXT;
CREATE INDEX "WebhookRoute_accountId_profileId_idx" ON "WebhookRoute"("accountId", "profileId");
