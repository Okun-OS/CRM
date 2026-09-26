-- CreateEnum
CREATE TYPE "ProspectStage" AS ENUM ('NEW', 'RESEARCHING', 'QUALIFIED', 'READY', 'IN_SEQUENCE', 'REPLIED', 'INTERESTED', 'NOT_INTERESTED', 'MEETING', 'CONVERTED', 'DISQUALIFIED', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "ProspectListKind" AS ENUM ('STATIC', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "SequenceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SequenceStepType" AS ENUM ('AUTOMATED_EMAIL', 'MANUAL_EMAIL', 'TASK', 'CALL_TASK', 'WAIT', 'CONDITION', 'CRM_ACTION');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "EnrollmentStopReason" AS ENUM ('REPLIED', 'MEETING_BOOKED', 'CONVERTED', 'BOUNCED', 'UNSUBSCRIBED', 'SUPPRESSED', 'MANUAL', 'SEQUENCE_ARCHIVED', 'FINISHED');

-- CreateEnum
CREATE TYPE "StepRunStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "SendingAccountStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "SuppressionScope" AS ENUM ('EMAIL', 'DOMAIN');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBED', 'BOUNCED', 'COMPLAINT', 'MANUAL', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "ReplyClassification" AS ENUM ('INTERESTED', 'QUESTION', 'MEETING_REQUEST', 'LATER', 'REFERRAL', 'NOT_INTERESTED', 'OUT_OF_OFFICE', 'UNSUBSCRIBE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OutreachLawfulBasis" AS ENUM ('UNREVIEWED', 'CLAIMED_LEGITIMATE_INTEREST', 'CLAIMED_CONSENT', 'EXISTING_CUSTOMER', 'REJECTED');

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "bounceReason" TEXT,
ADD COLUMN     "bouncedAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "enrollmentId" TEXT,
ADD COLUMN     "prospectId" TEXT,
ADD COLUMN     "replyClassification" "ReplyClassification",
ADD COLUMN     "replyConfidence" INTEGER,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "sendingAccountId" TEXT,
ADD COLUMN     "stepRunId" TEXT,
ADD COLUMN     "threadKey" TEXT;

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stage" "ProspectStage" NOT NULL DEFAULT 'NEW',
    "companyName" TEXT NOT NULL,
    "domain" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "employeeCount" INTEGER,
    "street" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "country" TEXT,
    "phone" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "jobTitle" TEXT,
    "linkedinUrl" TEXT,
    "sourceKey" TEXT NOT NULL,
    "sourceRef" TEXT,
    "score" INTEGER,
    "scoreReason" TEXT,
    "qualification" TEXT,
    "disqualifiedReason" TEXT,
    "lawfulBasis" "OutreachLawfulBasis" NOT NULL DEFAULT 'UNREVIEWED',
    "lawfulBasisNote" TEXT,
    "ownerId" TEXT,
    "createdById" TEXT,
    "contactId" TEXT,
    "companyId" TEXT,
    "dealId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "firstContactedAt" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "interestedAt" TIMESTAMP(3),
    "meetingAt" TIMESTAMP(3),
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProvenanceRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "reference" TEXT,
    "confidence" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProvenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "ProspectListKind" NOT NULL DEFAULT 'STATIC',
    "filter" JSONB,
    "ownerId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ProspectList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectListMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectListMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" "SuppressionScope" NOT NULL DEFAULT 'EMAIL',
    "value" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendingAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "connectionId" TEXT,
    "userId" TEXT,
    "status" "SendingAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "dailyLimit" INTEGER NOT NULL DEFAULT 50,
    "sendWindowStart" INTEGER NOT NULL DEFAULT 8,
    "sendWindowEnd" INTEGER NOT NULL DEFAULT 18,
    "sendDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "minGapSeconds" INTEGER NOT NULL DEFAULT 90,
    "maxGapSeconds" INTEGER NOT NULL DEFAULT 600,
    "signatureHtml" TEXT,
    "pausedReason" TEXT,
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SendingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SequenceStatus" NOT NULL DEFAULT 'DRAFT',
    "sendingAccountId" TEXT,
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "stopOnMeeting" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "SequenceStepType" NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "delayHours" INTEGER NOT NULL DEFAULT 0,
    "templateId" TEXT,
    "subject" TEXT,
    "bodyHtml" TEXT,
    "taskTitle" TEXT,
    "taskDescription" TEXT,
    "condition" JSONB,
    "actionConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "listId" TEXT,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextStepAt" TIMESTAMP(3),
    "stoppedReason" "EnrollmentStopReason",
    "stoppedNote" TEXT,
    "enrolledById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentStepRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" "StepRunStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "outcomeReason" TEXT,
    "sendingAccountId" TEXT,
    "taskId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrollmentStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prospect_organizationId_stage_updatedAt_idx" ON "Prospect"("organizationId", "stage", "updatedAt");

-- CreateIndex
CREATE INDEX "Prospect_organizationId_email_idx" ON "Prospect"("organizationId", "email");

-- CreateIndex
CREATE INDEX "Prospect_organizationId_domain_idx" ON "Prospect"("organizationId", "domain");

-- CreateIndex
CREATE INDEX "Prospect_organizationId_ownerId_stage_idx" ON "Prospect"("organizationId", "ownerId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_organizationId_sourceKey_sourceRef_key" ON "Prospect"("organizationId", "sourceKey", "sourceRef");

-- CreateIndex
CREATE INDEX "ProvenanceRecord_organizationId_prospectId_field_idx" ON "ProvenanceRecord"("organizationId", "prospectId", "field");

-- CreateIndex
CREATE INDEX "ProspectList_organizationId_archivedAt_idx" ON "ProspectList"("organizationId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectList_organizationId_name_key" ON "ProspectList"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ProspectListMembership_organizationId_prospectId_idx" ON "ProspectListMembership"("organizationId", "prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectListMembership_listId_prospectId_key" ON "ProspectListMembership"("listId", "prospectId");

-- CreateIndex
CREATE INDEX "SuppressionEntry_organizationId_createdAt_idx" ON "SuppressionEntry"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_organizationId_scope_value_key" ON "SuppressionEntry"("organizationId", "scope", "value");

-- CreateIndex
CREATE INDEX "SendingAccount_organizationId_status_idx" ON "SendingAccount"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SendingAccount_organizationId_fromEmail_key" ON "SendingAccount"("organizationId", "fromEmail");

-- CreateIndex
CREATE INDEX "Sequence_organizationId_status_idx" ON "Sequence"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_organizationId_name_key" ON "Sequence"("organizationId", "name");

-- CreateIndex
CREATE INDEX "SequenceStep_organizationId_sequenceId_idx" ON "SequenceStep"("organizationId", "sequenceId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_sequenceId_position_key" ON "SequenceStep"("sequenceId", "position");

-- CreateIndex
CREATE INDEX "SequenceEnrollment_organizationId_status_nextStepAt_idx" ON "SequenceEnrollment"("organizationId", "status", "nextStepAt");

-- CreateIndex
CREATE INDEX "SequenceEnrollment_organizationId_prospectId_idx" ON "SequenceEnrollment"("organizationId", "prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceEnrollment_sequenceId_prospectId_key" ON "SequenceEnrollment"("sequenceId", "prospectId");

-- CreateIndex
CREATE INDEX "EnrollmentStepRun_organizationId_status_scheduledFor_idx" ON "EnrollmentStepRun"("organizationId", "status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentStepRun_enrollmentId_stepId_key" ON "EnrollmentStepRun"("enrollmentId", "stepId");

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvenanceRecord" ADD CONSTRAINT "ProvenanceRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvenanceRecord" ADD CONSTRAINT "ProvenanceRecord_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectList" ADD CONSTRAINT "ProspectList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectList" ADD CONSTRAINT "ProspectList_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectList" ADD CONSTRAINT "ProspectList_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectListMembership" ADD CONSTRAINT "ProspectListMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectListMembership" ADD CONSTRAINT "ProspectListMembership_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ProspectList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectListMembership" ADD CONSTRAINT "ProspectListMembership_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectListMembership" ADD CONSTRAINT "ProspectListMembership_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionEntry" ADD CONSTRAINT "SuppressionEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionEntry" ADD CONSTRAINT "SuppressionEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingAccount" ADD CONSTRAINT "SendingAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingAccount" ADD CONSTRAINT "SendingAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingAccount" ADD CONSTRAINT "SendingAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ProspectList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_enrolledById_fkey" FOREIGN KEY ("enrolledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentStepRun" ADD CONSTRAINT "EnrollmentStepRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentStepRun" ADD CONSTRAINT "EnrollmentStepRun_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "SequenceEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentStepRun" ADD CONSTRAINT "EnrollmentStepRun_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SequenceStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentStepRun" ADD CONSTRAINT "EnrollmentStepRun_sendingAccountId_fkey" FOREIGN KEY ("sendingAccountId") REFERENCES "SendingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentStepRun" ADD CONSTRAINT "EnrollmentStepRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "SequenceEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_stepRunId_fkey" FOREIGN KEY ("stepRunId") REFERENCES "EnrollmentStepRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_sendingAccountId_fkey" FOREIGN KEY ("sendingAccountId") REFERENCES "SendingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
