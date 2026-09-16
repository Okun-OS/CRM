-- CreateEnum
CREATE TYPE "OperationalState" AS ENUM ('WAITING_FOR_US', 'WAITING_FOR_CUSTOMER', 'SCHEDULED', 'NO_NEXT_ACTION', 'CLOSED');

-- CreateEnum
CREATE TYPE "NextActionType" AS ENUM ('CONTACT_LEAD', 'QUALIFY_LEAD', 'FOLLOW_UP', 'CALL', 'SCHEDULE_MEETING', 'CONFIRM_MEETING', 'PREPARE_MEETING', 'CREATE_OFFER', 'SEND_OFFER', 'CHASE_OFFER', 'GET_DECISION', 'PREPARE_CONTRACT', 'REACTIVATE', 'DEFINE_NEXT_STEP', 'CUSTOM');

-- CreateEnum
CREATE TYPE "NextActionStatus" AS ENUM ('OPEN', 'DONE', 'DISMISSED', 'SUPERSEDED', 'SNOOZED');

-- CreateEnum
CREATE TYPE "Momentum" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'STALLED');

-- CreateEnum
CREATE TYPE "AutomationType" AS ENUM ('FOLLOW_UP_EMAIL', 'FOLLOW_UP_TASK', 'RECALL', 'REMINDER');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('PENDING', 'EXECUTED', 'SKIPPED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('USER', 'SYSTEM', 'AUTOMATION', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "CrmEventType" AS ENUM ('CONTACT_CREATED', 'LEAD_CREATED', 'LEAD_STATUS_CHANGED', 'DEAL_CREATED', 'DEAL_STAGE_CHANGED', 'DEAL_UPDATED', 'EMAIL_SENT', 'EMAIL_RECEIVED', 'CALL_LOGGED', 'NOTE_ADDED', 'MEETING_BOOKED', 'MEETING_COMPLETED', 'MEETING_CANCELLED', 'OFFER_CREATED', 'OFFER_SENT', 'OFFER_VIEWED', 'CUSTOMER_REPLIED', 'TASK_CREATED', 'TASK_COMPLETED', 'CONTRACT_SENT', 'CONTRACT_ACCEPTED', 'PAYMENT_RECEIVED', 'DEAL_WON', 'DEAL_LOST', 'NEXT_ACTION_COMPLETED', 'NEXT_ACTION_SNOOZED', 'AUTOMATION_EXECUTED', 'AUTOMATION_CANCELLED', 'RECALL_REQUESTED');

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "lastCustomerResponseAt" TIMESTAMP(3),
ADD COLUMN     "lastOutboundAt" TIMESTAMP(3),
ADD COLUMN     "momentum" "Momentum" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "momentumSignals" JSONB,
ADD COLUMN     "nextActionAt" TIMESTAMP(3),
ADD COLUMN     "nextActionTitle" TEXT,
ADD COLUMN     "nextActionType" "NextActionType",
ADD COLUMN     "nextMeetingAt" TIMESTAMP(3),
ADD COLUMN     "offerSentAt" TIMESTAMP(3),
ADD COLUMN     "operationalState" "OperationalState" NOT NULL DEFAULT 'NO_NEXT_ACTION',
ADD COLUMN     "stageEnteredAt" TIMESTAMP(3),
ADD COLUMN     "stalledSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "lastCustomerResponseAt" TIMESTAMP(3),
ADD COLUMN     "lastOutboundAt" TIMESTAMP(3),
ADD COLUMN     "momentum" "Momentum" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "momentumSignals" JSONB,
ADD COLUMN     "nextActionAt" TIMESTAMP(3),
ADD COLUMN     "nextActionTitle" TEXT,
ADD COLUMN     "nextActionType" "NextActionType",
ADD COLUMN     "nextMeetingAt" TIMESTAMP(3),
ADD COLUMN     "operationalState" "OperationalState" NOT NULL DEFAULT 'NO_NEXT_ACTION',
ADD COLUMN     "stalledSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DomainEventRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "CrmEventType" NOT NULL,
    "source" "EventSource" NOT NULL DEFAULT 'SYSTEM',
    "idempotencyKey" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "dealId" TEXT,
    "leadId" TEXT,
    "actorId" TEXT,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEventRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NextAction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "NextActionType" NOT NULL,
    "status" "NextActionStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ruleKey" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 50,
    "ownerId" TEXT,
    "contactId" TEXT,
    "companyId" TEXT,
    "dealId" TEXT,
    "leadId" TEXT,
    "taskId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "dismissReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NextAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledAutomation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "AutomationType" NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "ruleKey" TEXT,
    "guards" JSONB,
    "payload" JSONB,
    "dealId" TEXT,
    "leadId" TEXT,
    "contactId" TEXT,
    "ownerId" TEXT,
    "templateId" TEXT,
    "createdById" TEXT,
    "executedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "outcomeReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomainEventRecord_organizationId_occurredAt_idx" ON "DomainEventRecord"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEventRecord_organizationId_type_occurredAt_idx" ON "DomainEventRecord"("organizationId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEventRecord_dealId_occurredAt_idx" ON "DomainEventRecord"("dealId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEventRecord_leadId_occurredAt_idx" ON "DomainEventRecord"("leadId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "DomainEventRecord_organizationId_idempotencyKey_key" ON "DomainEventRecord"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "NextAction_organizationId_status_dueAt_idx" ON "NextAction"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "NextAction_organizationId_ownerId_status_dueAt_idx" ON "NextAction"("organizationId", "ownerId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "NextAction_dealId_status_idx" ON "NextAction"("dealId", "status");

-- CreateIndex
CREATE INDEX "NextAction_leadId_status_idx" ON "NextAction"("leadId", "status");

-- CreateIndex
CREATE INDEX "ScheduledAutomation_organizationId_status_scheduledFor_idx" ON "ScheduledAutomation"("organizationId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "ScheduledAutomation_dealId_status_idx" ON "ScheduledAutomation"("dealId", "status");

-- CreateIndex
CREATE INDEX "ScheduledAutomation_leadId_status_idx" ON "ScheduledAutomation"("leadId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_revokedAt_idx" ON "ApiKey"("organizationId", "revokedAt");

-- CreateIndex
CREATE INDEX "Deal_organizationId_operationalState_nextActionAt_idx" ON "Deal"("organizationId", "operationalState", "nextActionAt");

-- CreateIndex
CREATE INDEX "Deal_organizationId_momentum_idx" ON "Deal"("organizationId", "momentum");

-- CreateIndex
CREATE INDEX "Lead_organizationId_operationalState_nextActionAt_idx" ON "Lead"("organizationId", "operationalState", "nextActionAt");

-- AddForeignKey
ALTER TABLE "DomainEventRecord" ADD CONSTRAINT "DomainEventRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEventRecord" ADD CONSTRAINT "DomainEventRecord_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEventRecord" ADD CONSTRAINT "DomainEventRecord_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEventRecord" ADD CONSTRAINT "DomainEventRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEventRecord" ADD CONSTRAINT "DomainEventRecord_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEventRecord" ADD CONSTRAINT "DomainEventRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextAction" ADD CONSTRAINT "NextAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextAction" ADD CONSTRAINT "NextAction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextAction" ADD CONSTRAINT "NextAction_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextAction" ADD CONSTRAINT "NextAction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextAction" ADD CONSTRAINT "NextAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextAction" ADD CONSTRAINT "NextAction_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextAction" ADD CONSTRAINT "NextAction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextAction" ADD CONSTRAINT "NextAction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledAutomation" ADD CONSTRAINT "ScheduledAutomation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledAutomation" ADD CONSTRAINT "ScheduledAutomation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledAutomation" ADD CONSTRAINT "ScheduledAutomation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledAutomation" ADD CONSTRAINT "ScheduledAutomation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledAutomation" ADD CONSTRAINT "ScheduledAutomation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledAutomation" ADD CONSTRAINT "ScheduledAutomation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledAutomation" ADD CONSTRAINT "ScheduledAutomation_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
