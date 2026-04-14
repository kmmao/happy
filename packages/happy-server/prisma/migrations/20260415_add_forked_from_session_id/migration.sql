-- Add forkedFromSessionId to Session: tracks which Happy session this was forked from
ALTER TABLE "Session" ADD COLUMN "forkedFromSessionId" TEXT;
