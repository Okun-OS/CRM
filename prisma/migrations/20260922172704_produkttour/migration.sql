-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tourFinishedAt" TIMESTAMP(3),
ADD COLUMN     "tourProgress" JSONB,
ADD COLUMN     "tourSeenVersion" INTEGER NOT NULL DEFAULT 0;
