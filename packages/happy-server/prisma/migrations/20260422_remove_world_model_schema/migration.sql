-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_goalId_fkey";

-- DropForeignKey
ALTER TABLE "AgentRole" DROP CONSTRAINT "AgentRole_accountId_fkey";

-- DropForeignKey
ALTER TABLE "AgentRole" DROP CONSTRAINT "AgentRole_projectId_fkey";

-- DropForeignKey
ALTER TABLE "WorldMember" DROP CONSTRAINT "WorldMember_accountId_fkey";

-- DropForeignKey
ALTER TABLE "WorldMember" DROP CONSTRAINT "WorldMember_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Decision" DROP CONSTRAINT "Decision_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Decision" DROP CONSTRAINT "Decision_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Decision" DROP CONSTRAINT "Decision_goalId_fkey";

-- DropForeignKey
ALTER TABLE "Goal" DROP CONSTRAINT "Goal_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Goal" DROP CONSTRAINT "Goal_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Goal" DROP CONSTRAINT "Goal_parentGoalId_fkey";

-- DropForeignKey
ALTER TABLE "AgentMessage" DROP CONSTRAINT "AgentMessage_accountId_fkey";

-- DropForeignKey
ALTER TABLE "AgentMessage" DROP CONSTRAINT "AgentMessage_projectId_fkey";

-- DropForeignKey
ALTER TABLE "WorldSuggestion" DROP CONSTRAINT "WorldSuggestion_accountId_fkey";

-- DropForeignKey
ALTER TABLE "WorldSuggestion" DROP CONSTRAINT "WorldSuggestion_projectId_fkey";

-- DropForeignKey
ALTER TABLE "WorldAuditLog" DROP CONSTRAINT "WorldAuditLog_accountId_fkey";

-- DropForeignKey
ALTER TABLE "WorldAuditLog" DROP CONSTRAINT "WorldAuditLog_projectId_fkey";

-- DropIndex
DROP INDEX "Task_goalId_idx";

-- DropIndex
DROP INDEX "Task_goalId_status_idx";

-- DropIndex
DROP INDEX "Task_waitingDecisionId_idx";

-- DropIndex
DROP INDEX "Task_assignedMemberId_status_idx";

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "laws",
DROP COLUMN "narrative";

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "assignedMemberId",
DROP COLUMN "goalId",
DROP COLUMN "roleType",
DROP COLUMN "waitingDecisionId";

-- DropTable
DROP TABLE "AgentRole";

-- DropTable
DROP TABLE "WorldMember";

-- DropTable
DROP TABLE "Decision";

-- DropTable
DROP TABLE "Goal";

-- DropTable
DROP TABLE "AgentMessage";

-- DropTable
DROP TABLE "WorldSuggestion";

-- DropTable
DROP TABLE "WorldAuditLog";
