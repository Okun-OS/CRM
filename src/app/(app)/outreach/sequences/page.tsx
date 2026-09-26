import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { PageHeader } from "@/components/ui/misc";
import { SequencesView } from "./sequences-view";

export const metadata: Metadata = { title: "Sequenzen" };
export const dynamic = "force-dynamic";

export default async function SequencesPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sequenzen"
        description="Mehrstufige Ansprache über Tage. Eine Antwort hält die Sequenz an — eine Abwesenheitsnotiz nicht."
      />
      <SequencesView canManage={can(actor, "outreach.sequences.manage")} />
    </div>
  );
}
