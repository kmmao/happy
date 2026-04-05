-- CreateTable
CREATE TABLE "KnowledgeAccess" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "knowledgeId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeAccess_sessionId_idx" ON "KnowledgeAccess"("sessionId");

-- CreateIndex
CREATE INDEX "KnowledgeAccess_knowledgeId_idx" ON "KnowledgeAccess"("knowledgeId");

-- CreateIndex
CREATE INDEX "KnowledgeAccess_projectId_sessionId_idx" ON "KnowledgeAccess"("projectId", "sessionId");

-- AddForeignKey
ALTER TABLE "KnowledgeAccess" ADD CONSTRAINT "KnowledgeAccess_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeAccess" ADD CONSTRAINT "KnowledgeAccess_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "ProjectKnowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
