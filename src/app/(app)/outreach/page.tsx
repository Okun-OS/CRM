import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/misc";
import { OverviewView } from "./overview-view";

export const metadata: Metadata = { title: "Outreach" };
export const dynamic = "force-dynamic";

export default async function OutreachOverviewPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Akquise"
        description="Von der Zielgruppe bis zum Kunden — in einem System. Der Trichter zeigt, was aus der Ansprache geworden ist, nicht wie viel verschickt wurde."
      />
      <OverviewView />
    </div>
  );
}
