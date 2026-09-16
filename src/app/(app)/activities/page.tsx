import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { PageHeader } from "@/components/ui/misc";
import { ActivitiesView } from "./activities-view";

export const metadata: Metadata = { title: "Aktivitäten" };
export const dynamic = "force-dynamic";

export default async function ActivitiesPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Aktivitäten"
        description="Jede Interaktion und jedes Systemereignis im CRM – chronologisch und filterbar."
      />
      <ActivitiesView canLog={can(actor, "activities.write")} currentUserId={actor.userId} />
    </div>
  );
}
