import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { prisma } from "@/lib/db";
import { scope } from "@/lib/tenant";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatNumber } from "@/lib/format";
import { BRAND } from "@/lib/brand/config";

export const metadata: Metadata = { title: "System" };
export const dynamic = "force-dynamic";

/** Operational overview: background work that is pending and product metadata. */
export default async function SystemPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "settings.manage")) {
    return (
      <Card>
        <EmptyState title="Keine Berechtigung" description="Diese Seite ist Administratorinnen und Administratoren vorbehalten." />
      </Card>
    );
  }

  const [pendingWebhooks, failedWebhooks, failedWorkflows, lastExecution, activeWorkflows] = await Promise.all([
    prisma.webhookDelivery.count({ where: { ...scope(actor), status: "PENDING" } }),
    prisma.webhookDelivery.count({ where: { ...scope(actor), status: "FAILED" } }),
    prisma.workflowExecution.count({ where: { ...scope(actor), status: "FAILED" } }),
    prisma.workflowExecution.findFirst({
      where: scope(actor),
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, status: true, workflow: { select: { name: true } } },
    }),
    prisma.workflow.count({ where: { ...scope(actor), isActive: true } }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="System" description="Betriebszustand der Automatisierung und Produktinformationen." />

      <Card>
        <CardHeader title="Automatisierung" />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-4">
            {[
              ["Aktive Workflows", activeWorkflows],
              ["Fehlgeschlagene Ausführungen", failedWorkflows],
              ["Webhooks in Wiederholung", pendingWebhooks],
              ["Webhooks endgültig fehlgeschlagen", failedWebhooks],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-2xs uppercase tracking-wide text-ink-400">{label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink-900">{formatNumber(Number(value))}</dd>
              </div>
            ))}
          </dl>
          {lastExecution ? (
            <p className="mt-4 border-t border-ink-100 pt-3 text-2xs text-ink-500">
              Letzte Ausführung: {lastExecution.workflow.name} · {lastExecution.status} ·{" "}
              {formatDateTime(lastExecution.startedAt)}
            </p>
          ) : null}
          <p className="mt-2 text-2xs leading-relaxed text-ink-500">
            Wiederholungen fehlgeschlagener Webhooks werden über einen wiederkehrenden Aufruf von{" "}
            <code className="rounded bg-ink-100 px-1 py-0.5 font-mono">retryPendingWebhookDeliveries()</code> ausgeführt.
            Ohne eingerichteten Scheduler bleiben sie im Status „in Wiederholung“.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Produkt" />
        <CardBody>
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Produkt</dt>
              <dd className="font-medium text-ink-900">{BRAND.productName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Hersteller</dt>
              <dd className="font-medium text-ink-900">{BRAND.vendorName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Leitidee</dt>
              <dd className="text-ink-700">{BRAND.tagline}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Mandantenfähigkeit</dt>
              <dd>
                <Badge tone="success">Aktiv – alle Daten sind organisationsgebunden</Badge>
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
