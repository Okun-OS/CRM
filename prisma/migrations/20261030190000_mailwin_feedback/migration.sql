-- AlterTable
ALTER TABLE "NextAction" ADD COLUMN     "dueAnnouncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Task_organizationId_externalSource_externalId_key" ON "Task"("organizationId", "externalSource", "externalId");

-- Bestehende Mailwin-Endpunkte abonnieren die neuen Ereignisse (v1.2.1).
-- Sie gab es vorher nicht, also kann sie niemand bewusst abbestellt haben.
UPDATE "WebhookEndpoint"
SET "events" = ARRAY(
  SELECT DISTINCT unnest("events" || ARRAY['deal.next_action_due', 'deal.deleted', 'contact.merged', 'suggestion.resolved']::TEXT[])
)
WHERE "format" = 'MAILWIN';
