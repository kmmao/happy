-- CreateTable: SupervisorDimension
-- User-defined health analysis dimensions per project.
-- Extends the built-in 9 dimensions with project-specific analysis instructions.

CREATE TABLE "SupervisorDimension" (
    "id"        TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "prompt"    TEXT NOT NULL,
    "enabled"   BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupervisorDimension_pkey" PRIMARY KEY ("id")
);

-- Foreign key: SupervisorDimension → Project (cascade delete)
ALTER TABLE "SupervisorDimension"
    ADD CONSTRAINT "SupervisorDimension_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique constraint: one key per project
CREATE UNIQUE INDEX "SupervisorDimension_projectId_key_key" ON "SupervisorDimension"("projectId", "key");

-- Index for fetching enabled dimensions per project
CREATE INDEX "SupervisorDimension_projectId_enabled_idx" ON "SupervisorDimension"("projectId", "enabled");
