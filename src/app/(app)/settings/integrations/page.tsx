import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { listIntegrations } from "@/server/services/settings";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { Check, Plug } from "lucide-react";

export const metadata: Metadata = { title: "Integrationen" };
export const dynamic = "force-dynamic";

/**
 * Integration catalogue.
 *
 * Providers whose adapter is not implemented say so plainly, including what an
 * administrator would have to supply. Nothing here offers a connect button that
 * would not actually connect anything.
 */
export default async function IntegrationsPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "settings.manage")) {
    return (
      <Card>
        <EmptyState title="Keine Berechtigung" description="Integrationen dürfen nur Administratorinnen und Administratoren verwalten." />
      </Card>
    );
  }

  const integrations = await listIntegrations(actor);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrationen"
        description="Verbindungen zu externen Systemen. Der Status ist ehrlich: Was noch nicht implementiert ist, ist hier als solches gekennzeichnet."
      />

      <div className="grid gap-3 md:grid-cols-2">
        {integrations.map((integration) => {
          const connected = integration.connection?.status === "CONNECTED";
          return (
            <Card key={integration.provider}>
              <CardHeader
                title={integration.name}
                description={integration.category}
                action={
                  connected ? (
                    <Badge tone="success" dot>
                      Verbunden
                    </Badge>
                  ) : integration.implemented ? (
                    <Badge tone="brand">Verfügbar</Badge>
                  ) : (
                    <Badge tone="neutral">Nicht verbunden</Badge>
                  )
                }
              />
              <CardBody className="space-y-3">
                <p className="text-xs leading-relaxed text-ink-600">{integration.summary}</p>

                <div>
                  <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">Funktionen</p>
                  <ul className="mt-1 space-y-0.5">
                    {integration.capabilities.map((capability) => (
                      <li key={capability} className="flex items-start gap-1.5 text-2xs text-ink-600">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-ink-400" />
                        {capability}
                      </li>
                    ))}
                  </ul>
                </div>

                {integration.implemented ? (
                  integration.provider === "ZAPIER" ? (
                    <p className="rounded-md bg-brand-50 px-3 py-2 text-2xs leading-relaxed text-brand-800">
                      Ausgehende Webhooks sind vollständig implementiert – Ziel-URLs werden im Bereich Webhooks verwaltet.
                    </p>
                  ) : null
                ) : (
                  <div className="rounded-md border border-ink-200 bg-ink-50/70 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-2xs font-medium text-ink-700">
                      <Plug className="h-3 w-3" /> Adapter noch nicht implementiert
                    </p>
                    <p className="mt-1 text-2xs leading-relaxed text-ink-500">
                      Die Architektur ist vorbereitet. Für die Aktivierung werden benötigt:
                    </p>
                    <ul className="mt-1 list-inside list-disc text-2xs text-ink-500">
                      {integration.requires.map((requirement) => (
                        <li key={requirement}>{requirement}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {integration.connection?.lastError ? (
                  <p className="text-2xs text-danger-600">Letzter Fehler: {integration.connection.lastError}</p>
                ) : null}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
