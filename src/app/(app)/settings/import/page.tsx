import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { listImportJobs } from "@/server/services/imports";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import" };
export const dynamic = "force-dynamic";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ objectType?: string }> }) {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "imports.run")) {
    return (
      <Card>
        <EmptyState title="Keine Berechtigung" description="Importe dürfen Managerinnen, Manager und Administratoren ausführen." />
      </Card>
    );
  }

  const { objectType } = await searchParams;
  const jobs = await listImportJobs(actor, { page: 1, pageSize: 10 });

  return (
    <div className="space-y-5">
      <PageHeader
        title="CSV-Import"
        description="Datei hochladen, Spalten zuordnen, Vorschau prüfen, importieren – inklusive Duplikatstrategie und Ergebnisbericht."
      />
      <ImportWizard
        initialObjectType={
          objectType === "COMPANY" || objectType === "LEAD" || objectType === "CONTACT" ? objectType : "CONTACT"
        }
        jobs={jobs.items}
      />
    </div>
  );
}
