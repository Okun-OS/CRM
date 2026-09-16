import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { listAuditLog } from "@/server/services/audit";
import { listMembers } from "@/server/services/users";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { AuditView } from "./audit-view";

export const metadata: Metadata = { title: "Audit Log" };
export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "audit.read")) {
    return (
      <Card>
        <EmptyState title="Keine Berechtigung" description="Das Audit Log dürfen Managerinnen, Manager und Administratoren einsehen." />
      </Card>
    );
  }

  const [log, members] = await Promise.all([listAuditLog(actor, { page: 1, pageSize: 50 }), listMembers(actor)]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Log"
        description="Wer hat was wann geändert. Einträge werden nur angehängt und nie verändert."
      />
      <AuditView
        initial={log}
        members={members.map((member) => ({ id: member.userId, name: member.name }))}
      />
    </div>
  );
}
