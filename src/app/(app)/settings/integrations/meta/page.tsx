import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { getMetaOverview } from "@/server/services/meta-settings";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { Breadcrumb } from "@/components/crm/record-detail";
import { MetaView } from "./meta-view";

export const metadata: Metadata = { title: "Meta Lead Ads" };
export const dynamic = "force-dynamic";

export default async function MetaSettingsPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "settings.manage")) {
    return (
      <Card>
        <EmptyState
          title="Keine Berechtigung"
          description="Die Meta-Verbindung dürfen nur Administratorinnen und Administratoren verwalten."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: "Integrationen", href: "/settings/integrations" }, { label: "Meta Lead Ads" }]} />}
        title="Meta Lead Ads"
        description="Leads aus Facebook- und Instagram-Formularen landen automatisch im CRM, und Sie bekommen für jeden neuen Lead eine E-Mail."
      />
      <MetaView initial={await getMetaOverview(actor)} />
    </div>
  );
}
