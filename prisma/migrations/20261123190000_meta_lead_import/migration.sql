-- AlterTable
ALTER TABLE "MetaLeadEvent" ADD COLUMN     "importedById" TEXT,
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'webhook',
ADD COLUMN     "rawLead" JSONB;
