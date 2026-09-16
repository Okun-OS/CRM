import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { PageHeader } from "@/components/ui/misc";
import { LeadsList } from "./leads-list";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leads"
        description="Neue Interessenten mit eigenem Qualifizierungsprozess – bis zur Konvertierung in Kontakt, Unternehmen und Deal."
      />
      <LeadsList
        canCreate={can(actor, "leads.write")}
        canDelete={can(actor, "leads.delete")}
        canExport={can(actor, "exports.run")}
        canImport={can(actor, "imports.run")}
      />
    </div>
  );
}
