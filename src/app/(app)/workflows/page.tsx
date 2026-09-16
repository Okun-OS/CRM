import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { PageHeader } from "@/components/ui/misc";
import { WorkflowsView } from "./workflows-view";

export const metadata: Metadata = { title: "Workflows" };
export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Workflows"
        description="Wiederkehrende Arbeit automatisieren: Trigger, Bedingungen und Aktionen – jede Ausführung wird protokolliert."
      />
      <WorkflowsView canManage={can(actor, "workflows.manage")} />
    </div>
  );
}
