import type { Metadata } from "next";
import Link from "next/link";
import { List } from "lucide-react";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { getPipelineBoard } from "@/server/services/deals";
import { listPipelines } from "@/server/services/pipelines";
import { getOrganization } from "@/server/services/organizations";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { PipelineBoard } from "./pipeline-board";

export const metadata: Metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ pipelineId?: string }>;
}) {
  const actor = await getActor();
  if (!actor) return null;

  const { pipelineId } = await searchParams;
  const [board, pipelines, organization] = await Promise.all([
    getPipelineBoard(actor, pipelineId),
    listPipelines(actor),
    getOrganization(actor),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pipeline"
        description="Deals per Drag & Drop durch die Stages bewegen – jede Änderung wird serverseitig gespeichert und protokolliert."
        actions={
          <Link href="/deals">
            <Button variant="secondary" icon={<List className="h-4 w-4" />}>
              Listenansicht
            </Button>
          </Link>
        }
      />

      {!board ? (
        <Card>
          <EmptyState
            title="Keine Pipeline konfiguriert"
            description="Lege unter Einstellungen → Pipelines eine Vertriebspipeline mit Stages an, um das Board zu nutzen."
            actions={
              <Link href="/settings/pipelines">
                <Button variant="primary">Pipeline konfigurieren</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <PipelineBoard
          board={board}
          pipelines={pipelines.map((pipeline) => ({ id: pipeline.id, name: pipeline.name }))}
          currency={organization?.currency ?? "EUR"}
          canEdit={can(actor, "deals.write")}
          canCreate={can(actor, "deals.write")}
        />
      )}
    </div>
  );
}
