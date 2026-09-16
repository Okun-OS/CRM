import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { listWebhookDeliveries, listWebhookEndpoints } from "@/server/services/webhooks";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { WebhooksView } from "./webhooks-view";

export const metadata: Metadata = { title: "Webhooks" };
export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "webhooks.manage")) {
    return (
      <Card>
        <EmptyState title="Keine Berechtigung" description="Webhooks dürfen nur Administratorinnen und Administratoren verwalten." />
      </Card>
    );
  }

  const [endpoints, deliveries] = await Promise.all([
    listWebhookEndpoints(actor),
    listWebhookDeliveries(actor, { page: 1, pageSize: 20 }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Webhooks"
        description="CRM-Ereignisse an externe Systeme senden – signiert mit HMAC-SHA256 und mit automatischen Wiederholungen."
      />
      <WebhooksView endpoints={endpoints} deliveries={deliveries.items} />
    </div>
  );
}
