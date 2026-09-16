import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { listAllDefinitions } from "@/server/services/property-definitions";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { PropertiesView } from "./properties-view";

export const metadata: Metadata = { title: "Eigenschaften" };
export const dynamic = "force-dynamic";

export default async function PropertiesSettingsPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "properties.manage")) {
    return (
      <Card>
        <EmptyState
          title="Keine Berechtigung"
          description="Eigene Eigenschaften dürfen Managerinnen, Manager und Administratoren verwalten."
        />
      </Card>
    );
  }

  const definitions = await listAllDefinitions(actor);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Eigenschaften"
        description="Eigene Felder für Kontakte, Unternehmen, Leads und Deals – ohne Codeänderung, sofort in Formularen, Filtern, Listen und Import verfügbar."
      />
      <PropertiesView definitions={definitions} />
    </div>
  );
}
