-- CreateTable
CREATE TABLE "AiBackendProfile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "profileKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "encryptedPayload" BYTEA NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiBackendProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiBackendProfile_accountId_idx" ON "AiBackendProfile"("accountId");

-- CreateIndex
CREATE INDEX "AiBackendProfile_accountId_archivedAt_idx" ON "AiBackendProfile"("accountId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiBackendProfile_accountId_profileKey_key" ON "AiBackendProfile"("accountId", "profileKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiBackendProfile_accountId_name_key" ON "AiBackendProfile"("accountId", "name");

-- AddForeignKey
ALTER TABLE "AiBackendProfile" ADD CONSTRAINT "AiBackendProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
