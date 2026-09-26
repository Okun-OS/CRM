import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { PageHeader } from "@/components/ui/misc";
import { ListsView } from "./lists-view";

export const metadata: Metadata = { title: "Listen" };
export const dynamic = "force-dynamic";

export default async function ListsPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Listen"
        description="Arbeitsvorrat für Recherche und Kampagnen. Statisch, wenn die Auswahl stehen soll — dynamisch, wenn sie sich mitbewegen darf."
      />
      <ListsView canWrite={can(actor, "prospects.write")} />
    </div>
  );
}
