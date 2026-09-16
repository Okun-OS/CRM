-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "automationPausedReason" TEXT,
ADD COLUMN     "automationPausedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "automationPausedReason" TEXT,
ADD COLUMN     "automationPausedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PipelineStage" ADD COLUMN     "expectedAction" "NextActionType",
ADD COLUMN     "expectedActionDays" INTEGER;

-- CreateTable
CREATE TABLE "ActiveCrmSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "automationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "leadContactWithinHours" INTEGER NOT NULL DEFAULT 24,
    "followUpAfterDays" INTEGER NOT NULL DEFAULT 3,
    "offerChaseAfterDays" INTEGER NOT NULL DEFAULT 5,
    "stagnationAfterDays" INTEGER NOT NULL DEFAULT 14,
    "meetingPrepLeadHours" INTEGER NOT NULL DEFAULT 24,
    "meetingFollowUpDays" INTEGER NOT NULL DEFAULT 2,
    "quietHoursStart" INTEGER NOT NULL DEFAULT 20,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 7,
    "workdaysOnly" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveCrmSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveCrmRuleSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "delayDays" INTEGER,
    "priority" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveCrmRuleSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActiveCrmSetting_organizationId_key" ON "ActiveCrmSetting"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveCrmRuleSetting_organizationId_ruleKey_key" ON "ActiveCrmRuleSetting"("organizationId", "ruleKey");

-- AddForeignKey
ALTER TABLE "ActiveCrmSetting" ADD CONSTRAINT "ActiveCrmSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveCrmRuleSetting" ADD CONSTRAINT "ActiveCrmRuleSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
