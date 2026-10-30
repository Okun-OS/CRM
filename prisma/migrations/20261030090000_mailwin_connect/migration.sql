-- CreateEnum
CREATE TYPE "WebhookFormat" AS ENUM ('STANDARD', 'MAILWIN');

-- AlterEnum
ALTER TYPE "ActivitySource" ADD VALUE 'MAILWIN';

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'WHATSAPP';

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "origin" TEXT;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "sourceRef" JSONB;

-- AlterTable
ALTER TABLE "WebhookEndpoint" ADD COLUMN     "format" "WebhookFormat" NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationRequestLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "credentialId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "errorCode" TEXT,
    "idempotencyKey" TEXT,
    "replayed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_organizationId_key_key" ON "IdempotencyRecord"("organizationId", "key");

-- CreateIndex
CREATE INDEX "IntegrationRequestLog_organizationId_integration_createdAt_idx" ON "IntegrationRequestLog"("organizationId", "integration", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationRequestLog_createdAt_idx" ON "IntegrationRequestLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_organizationId_externalSource_externalId_key" ON "Activity"("organizationId", "externalSource", "externalId");

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationRequestLog" ADD CONSTRAINT "IntegrationRequestLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
