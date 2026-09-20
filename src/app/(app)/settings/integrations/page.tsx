import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { listConnections } from "@/server/services/integrations";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { IntegrationsView } from "./integrations-view";

export const metadata: Metadata = { title: "Integrationen" };
export const dynamic = "force-dynamic";

/**
 * Integrationskatalog.
 *
 * Anbieter ohne umgesetzten Adapter sagen das unverblümt, samt dem, was ein
 * Administrator bereitstellen müsste. Es gibt keinen Verbinden-Knopf, der
 * nichts verbindet — umgekehrt ist SMTP jetzt tatsächlich verbindbar.
 */
export default async function IntegrationsPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "settings.manage")) {
    return (
      <Card>
        <EmptyState
          title="Keine Berechtigung"
          description="Integrationen dürfen nur Administratorinnen und Administratoren verwalten."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrationen"
        description="Was verbunden ist, arbeitet. Was nicht umgesetzt ist, sagt es — statt einen Knopf anzubieten, der ins Leere führt."
      />
      <IntegrationsView initial={await listConnections(actor)} />
    </div>
  );
}
