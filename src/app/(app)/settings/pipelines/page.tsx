import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { listPipelines } from "@/server/services/pipelines";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { PipelinesView } from "./pipelines-view";

export const metadata: Metadata = { title: "Pipelines" };
export const dynamic = "force-dynamic";

export default async function PipelinesSettingsPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "pipelines.manage")) {
    return (
      <Card>
        <EmptyState title="Keine Berechtigung" description="Pipelines dürfen Managerinnen, Manager und Administratoren verwalten." />
      </Card>
    );
  }

  const pipelines = await listPipelines(actor);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pipelines"
        description="Vertriebsprozesse und ihre Stages. Stages mit Deals werden nie stillschweigend gelöscht."
      />
      <PipelinesView pipelines={pipelines} />
    </div>
  );
}
