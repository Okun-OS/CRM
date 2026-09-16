import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { PageHeader } from "@/components/ui/misc";
import { CompaniesList } from "./companies-list";

export const metadata: Metadata = { title: "Unternehmen" };
export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader title="Unternehmen" description="Die Organisationen hinter deinen Kontakten und Deals." />
      <CompaniesList
        canCreate={can(actor, "companies.write")}
        canDelete={can(actor, "companies.delete")}
        canExport={can(actor, "exports.run")}
        canImport={can(actor, "imports.run")}
      />
    </div>
  );
}
