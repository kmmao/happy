-- CreateTable WorldMember
CREATE TABLE "WorldMember" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "displayName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "expertise" TEXT NOT NULL DEFAULT '[]',
    "lawAuthority" TEXT NOT NULL DEFAULT 'suggest',
    "decisionScope" TEXT NOT NULL DEFAULT 'assigned',
    "goalAuthority" TEXT NOT NULL DEFAULT 'create',
    "notifyLevel" TEXT NOT NULL DEFAULT 'all',
    "availability" TEXT NOT NULL DEFAULT 'active',
    "delegateTo" TEXT,
    "maxConcurrency" INTEGER NOT NULL DEFAULT 3,
    "assignedRoleIds" TEXT NOT NULL DEFAULT '[]',
    "agentType" TEXT,
    "modelOverride" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable WorldAuditLog
CREATE TABLE "WorldAuditLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "memberId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorldAuditLog_pkey" PRIMARY KEY ("id")
);

-- AlterTable Task: add assignedMemberId
ALTER TABLE "Task" ADD COLUMN "assignedMemberId" TEXT;

-- CreateIndex WorldMember
CREATE UNIQUE INDEX "WorldMember_accountId_projectId_key" ON "WorldMember"("accountId", "projectId");
CREATE INDEX "WorldMember_projectId_role_idx" ON "WorldMember"("projectId", "role");
CREATE INDEX "WorldMember_projectId_availability_idx" ON "WorldMember"("projectId", "availability");

-- CreateIndex WorldAuditLog
CREATE INDEX "WorldAuditLog_projectId_createdAt_idx" ON "WorldAuditLog"("projectId", "createdAt" DESC);
CREATE INDEX "WorldAuditLog_projectId_entityType_createdAt_idx" ON "WorldAuditLog"("projectId", "entityType", "createdAt" DESC);
CREATE INDEX "WorldAuditLog_accountId_createdAt_idx" ON "WorldAuditLog"("accountId", "createdAt" DESC);

-- CreateIndex Task.assignedMemberId
CREATE INDEX "Task_assignedMemberId_status_idx" ON "Task"("assignedMemberId", "status");

-- AddForeignKey WorldMember -> Account
ALTER TABLE "WorldMember" ADD CONSTRAINT "WorldMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey WorldMember -> Project
ALTER TABLE "WorldMember" ADD CONSTRAINT "WorldMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey WorldAuditLog -> Account
ALTER TABLE "WorldAuditLog" ADD CONSTRAINT "WorldAuditLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey WorldAuditLog -> Project
ALTER TABLE "WorldAuditLog" ADD CONSTRAINT "WorldAuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable Decision: add WorldMember integration columns
ALTER TABLE "Decision"
    ADD COLUMN "assignedTo" TEXT,
    ADD COLUMN "assignHistory" TEXT NOT NULL DEFAULT '[]',
    ADD COLUMN "opinions" TEXT NOT NULL DEFAULT '[]';

CREATE INDEX "Decision_assignedTo_status_idx" ON "Decision"("assignedTo", "status");
