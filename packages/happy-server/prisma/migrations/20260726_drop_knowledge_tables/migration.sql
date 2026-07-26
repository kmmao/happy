-- Drop the project knowledge base subsystem.
--
-- Memory responsibility migrated to the explicit docs system (CONTEXT.md +
-- ADRs + backlog.md + CLAUDE.md + skills). The knowledge base had zero writes
-- since 2026-05-24 and 0 of 46 projects had it enabled. Application code was
-- removed in 阶段 1-3 (cfe94f4dd, 5682d5802, 382c010da); this is 阶段 4.
--
-- Active entries were archived to docs/archive/knowledge/ before this ran.
--
-- NOTE: `prisma migrate diff` also proposed `DROP INDEX
-- "Session_parentSessionId_idx"`. That was deliberately excluded — the index
-- is created by 20260504_add_parent_session_id and is genuinely in use; it
-- only looks orphaned because schema.prisma never declared the matching
-- @@index([parentSessionId]). That drift is pre-existing and out of scope here.

-- DropForeignKey
ALTER TABLE "KnowledgeAccess" DROP CONSTRAINT "KnowledgeAccess_knowledgeId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgeAccess" DROP CONSTRAINT "KnowledgeAccess_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgeRelation" DROP CONSTRAINT "KnowledgeRelation_fromEntryId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgeRelation" DROP CONSTRAINT "KnowledgeRelation_toEntryId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectKnowledge" DROP CONSTRAINT "ProjectKnowledge_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectKnowledge" DROP CONSTRAINT "ProjectKnowledge_supersedesId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectProfile" DROP CONSTRAINT "ProjectProfile_projectId_fkey";

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "knowledgeConfig";

-- AlterTable
ALTER TABLE "Skill" DROP COLUMN "sourceKnowledgeId";

-- DropTable
DROP TABLE "KnowledgeAccess";

-- DropTable
DROP TABLE "KnowledgeRelation";

-- DropTable
DROP TABLE "ProjectKnowledge";

-- DropTable
DROP TABLE "ProjectProfile";
