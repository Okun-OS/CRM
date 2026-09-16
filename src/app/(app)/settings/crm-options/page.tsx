import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { listLeadStatuses, listLifecycleStages, listTags } from "@/server/services/settings";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { CrmOptionsView } from "./crm-options-view";

export const metadata: Metadata = { title: "Status & Tags" };
export const dynamic = "force-dynamic";

export default async function CrmOptionsPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "settings.manage")) {
    return (
      <Card>
        <EmptyState title="Keine Berechtigung" description="Diese Konfiguration dürfen nur Administratorinnen und Administratoren ändern." />
      </Card>
    );
  }

  const [lifecycleStages, leadStatuses, tags] = await Promise.all([
    listLifecycleStages(actor),
    listLeadStatuses(actor),
    listTags(actor),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Status & Tags"
        description="Lifecycle Stages, Lead-Status und Tags konfigurieren – ohne Codeänderung. Systemwerte sind geschützt."
      />
      <CrmOptionsView
        lifecycleStages={lifecycleStages.map((stage) => ({
          id: stage.id,
          key: stage.key,
          label: stage.label,
          position: stage.position,
          isSystem: stage.isSystem,
        }))}
        leadStatuses={leadStatuses.map((status) => ({
          id: status.id,
          key: status.key,
          label: status.label,
          position: status.position,
          isSystem: status.isSystem,
          isTerminal: status.isTerminal,
        }))}
        tags={tags.map((tag) => ({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          usage: tag._count.contacts + tag._count.companies + tag._count.deals,
        }))}
      />
    </div>
  );
}
