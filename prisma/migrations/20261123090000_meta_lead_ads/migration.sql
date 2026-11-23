-- CreateEnum
CREATE TYPE "MetaLeadStatus" AS ENUM ('PENDING', 'CREATED', 'MERGED', 'FAILED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LEAD_RECEIVED';

-- CreateTable
CREATE TABLE "MetaLeadPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "pageName" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL,
    "ownerId" TEXT,
    "notifyEmails" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "connectedById" TEXT,
    "lastLeadAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaLeadPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaLeadEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "leadgenId" TEXT NOT NULL,
    "formId" TEXT,
    "adId" TEXT,
    "status" "MetaLeadStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leadId" TEXT,
    "summary" JSONB,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "MetaLeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetaLeadPage_pageId_key" ON "MetaLeadPage"("pageId");

-- CreateIndex
CREATE INDEX "MetaLeadPage_organizationId_idx" ON "MetaLeadPage"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaLeadEvent_leadgenId_key" ON "MetaLeadEvent"("leadgenId");

-- CreateIndex
CREATE INDEX "MetaLeadEvent_status_nextAttemptAt_idx" ON "MetaLeadEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MetaLeadEvent_organizationId_receivedAt_idx" ON "MetaLeadEvent"("organizationId", "receivedAt");

-- AddForeignKey
ALTER TABLE "MetaLeadPage" ADD CONSTRAINT "MetaLeadPage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaLeadEvent" ADD CONSTRAINT "MetaLeadEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
