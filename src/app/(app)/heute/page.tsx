import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { PageHeader } from "@/components/ui/misc";
import { ActionCenter } from "./action-center";

export const metadata: Metadata = { title: "Heute" };
export const dynamic = "force-dynamic";

/**
 * The action center. This is the screen the working day starts on: not a list
 * of records, but a list of decisions — each with the reason it is on the list.
 */
export default async function TodayPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Heute"
        description="Was heute ansteht – priorisiert, mit Begründung und in der Reihenfolge, in der ein Vertriebstag abgearbeitet wird."
      />
      <ActionCenter
        currentUser={{ id: actor.userId, name: actor.name }}
        canEdit={can(actor, "deals.write") || can(actor, "leads.write")}
      />
    </div>
  );
}
