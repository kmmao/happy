-- Per-trigger model-mode KEY + reasoning effort (plain-text, nullable).
-- Added for "model + effort selection on schedule / webhook / loop triggers".

-- TriggerSchedule (cron)
ALTER TABLE "TriggerSchedule" ADD COLUMN "modelMode" TEXT;
ALTER TABLE "TriggerSchedule" ADD COLUMN "effort" TEXT;

-- WebhookTrigger (event)
ALTER TABLE "WebhookTrigger" ADD COLUMN "modelMode" TEXT;
ALTER TABLE "WebhookTrigger" ADD COLUMN "effort" TEXT;

-- AgentLoop (loop)
ALTER TABLE "AgentLoop" ADD COLUMN "modelMode" TEXT;
ALTER TABLE "AgentLoop" ADD COLUMN "effort" TEXT;
