import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { getActiveCrmConfiguration } from "@/server/services/active-crm-settings";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { ActiveCrmSettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Aktives CRM" };
export const dynamic = "force-dynamic";

export default async function ActiveCrmSettingsPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "settings.manage")) {
    return (
      <Card>
        <EmptyState
          title="Keine Berechtigung"
          description="Die Regeln des aktiven CRM dürfen nur Administratorinnen und Administratoren ändern."
        />
      </Card>
    );
  }

  const configuration = await getActiveCrmConfiguration(actor);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Aktives CRM"
        description="Fristen und Regeln, mit denen OKUN CRM den nächsten Schritt bestimmt. Alles hier Eingestellte liest die Engine zur Laufzeit – es gibt keine zweite, verborgene Konfiguration."
      />
      <ActiveCrmSettingsView initial={configuration} />
    </div>
  );
}
