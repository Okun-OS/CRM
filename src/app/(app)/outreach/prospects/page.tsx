import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { PageHeader } from "@/components/ui/misc";
import { ProspectsView } from "./prospects-view";

export const metadata: Metadata = { title: "Prospects" };
export const dynamic = "force-dynamic";

export default async function ProspectsPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Prospects"
        description="Potenzielle Kunden, bevor sie Kontakte sind — mit dokumentierter Herkunft und geprüfter Kontaktsperre."
      />
      <ProspectsView
        canWrite={can(actor, "prospects.write")}
        canEnroll={can(actor, "outreach.enroll")}
      />
    </div>
  );
}
