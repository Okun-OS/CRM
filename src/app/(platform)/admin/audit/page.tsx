import Link from "next/link";
import { getPlatformActor } from "@/lib/auth/session";
import { listPlatformAudit } from "@/server/services/platform";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Protokoll" };
export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  "customer.created": "Kunde angelegt",
  "customer.suspended": "Kunde stillgelegt",
  "customer.reactivated": "Kunde reaktiviert",
  "customer.admin_invited": "Zugang eingeladen",
  "platform_admin.granted": "Betreiberrecht vergeben",
  "platform_admin.revoked": "Betreiberrecht entzogen",
};

export default async function PlatformAuditPage() {
  const actor = await getPlatformActor();
  if (!actor) return null;

  const entries = await listPlatformAudit(actor, 200);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Betreiberprotokoll"
        description="Jede Handlung dieses Bereichs, unveränderlich festgehalten. Getrennt vom Audit-Log der Mandanten — das gehört ihnen."
      />

      {entries.length === 0 ? (
        <Card>
          <EmptyState title="Noch keine Einträge" description="Sobald hier etwas geschieht, steht es in diesem Protokoll." />
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <ul className="divide-y divide-ink-100">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                  <span className="w-40 shrink-0 text-2xs tabular-nums text-ink-500">{formatDateTime(entry.createdAt)}</span>
                  <span className="text-sm text-ink-900">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                  {entry.organizationName ? (
                    entry.organizationId ? (
                      <Link href={`/admin/${entry.organizationId}`} className="text-sm text-brand-600 hover:text-brand-700">
                        {entry.organizationName}
                      </Link>
                    ) : (
                      <span className="text-sm text-ink-700">{entry.organizationName}</span>
                    )
                  ) : null}
                  <span className="ml-auto text-2xs text-ink-500">{entry.actorEmail}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
