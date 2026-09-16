import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { getOrganization } from "@/server/services/organizations";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { OrganizationForm } from "./organization-form";

export const metadata: Metadata = { title: "Unternehmen" };
export const dynamic = "force-dynamic";

export default async function OrganizationSettingsPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "organization.manage")) {
    return (
      <Card>
        <EmptyState
          title="Keine Berechtigung"
          description="Nur Administratorinnen und Administratoren können die Organisationsdaten bearbeiten."
        />
      </Card>
    );
  }

  const organization = await getOrganization(actor);
  if (!organization) return null;

  return (
    <div className="space-y-5">
      <PageHeader title="Unternehmen" description="Stammdaten der Organisation und regionale Voreinstellungen." />
      <OrganizationForm organization={organization} />
    </div>
  );
}
