-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "RecordSuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "dealId" TEXT,
    "contactId" TEXT,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "evidence" JSONB,
    "nextActionId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSetting" (
    "organizationId" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("organizationId","integration")
);

-- CreateIndex
CREATE INDEX "RecordSuggestion_organizationId_status_createdAt_idx" ON "RecordSuggestion"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RecordSuggestion_dealId_status_idx" ON "RecordSuggestion"("dealId", "status");

-- CreateIndex
CREATE INDEX "RecordSuggestion_contactId_status_idx" ON "RecordSuggestion"("contactId", "status");

-- AddForeignKey
ALTER TABLE "RecordSuggestion" ADD CONSTRAINT "RecordSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordSuggestion" ADD CONSTRAINT "RecordSuggestion_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordSuggestion" ADD CONSTRAINT "RecordSuggestion_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSetting" ADD CONSTRAINT "IntegrationSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
