import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import Link from "next/link";
import { ChevronRight, Mail } from "lucide-react";
import { listConnections } from "@/server/services/integrations";
import { listMailwinKeys } from "@/server/mailwin/settings";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
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
      <MailwinCard actorKeys={await listMailwinKeys(actor)} />
      <IntegrationsView initial={await listConnections(actor)} />
    </div>
  );
}

/** OKUN-Produkte sind keine Fremdanbieter — sie stehen oben und führen auf ihre eigene Seite. */
function MailwinCard({ actorKeys }: { actorKeys: Awaited<ReturnType<typeof listMailwinKeys>> }) {
  const active = actorKeys.filter((key) => !key.revokedAt);
  const lastUsed = active.map((key) => key.lastUsedAt).filter(Boolean).sort().pop() ?? null;

  return (
    <Card>
      <CardHeader title="OKUN-Produkte" />
      <CardBody className="p-0">
        <Link
          href="/settings/integrations/mailwin"
          className="flex flex-wrap items-center gap-4 px-4 py-4 transition-colors hover:bg-ink-50"
          data-tour="integration-mailwin"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Mail className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink-900">OKUN Mailwin</span>
              {active.length === 0 ? (
                <Badge tone="neutral">Nicht verbunden</Badge>
              ) : lastUsed ? (
                <Badge tone="success" dot>Verbunden</Badge>
              ) : (
                <Badge tone="warning" dot>Schlüssel bereit</Badge>
              )}
            </span>
            <span className="mt-1 block text-xs text-ink-600">
              KI-E-Mail-Assistent: legt aus E-Mails Leads an, schlägt Kontakte nach und protokolliert Nachrichten in der Zeitleiste.
            </span>
            {lastUsed ? <span className="mt-1 block text-2xs text-ink-500">Zuletzt aktiv: {formatDateTime(lastUsed)}</span> : null}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
        </Link>
      </CardBody>
    </Card>
  );
}
