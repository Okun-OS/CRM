-- AlterTable
ALTER TABLE "MetaLeadPage" ADD COLUMN     "lastPolledAt" TIMESTAMP(3),
ADD COLUMN     "lastWebhookAt" TIMESTAMP(3);
