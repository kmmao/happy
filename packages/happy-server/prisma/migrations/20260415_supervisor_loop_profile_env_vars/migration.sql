-- AlterTable: add profileEnvironmentVariables to SupervisorLoop
ALTER TABLE "SupervisorLoop" ADD COLUMN IF NOT EXISTS "profileEnvironmentVariables" JSONB;
