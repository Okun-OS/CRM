import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { getMailwinOverview } from "@/server/mailwin/settings";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { Breadcrumb } from "@/components/crm/record-detail";
import { MailwinView } from "./mailwin-view";

export const metadata: Metadata = { title: "Mailwin" };
export const dynamic = "force-dynamic";

export default async function MailwinSettingsPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "settings.manage")) {
    return (
      <Card>
        <EmptyState
          title="Keine Berechtigung"
          description="Die Mailwin-Verbindung dürfen nur Administratorinnen und Administratoren verwalten."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: "Integrationen", href: "/settings/integrations" }, { label: "Mailwin" }]} />}
        title="OKUN Mailwin"
        description="Mailwin legt aus E-Mails (und später WhatsApp-Nachrichten) Leads an, schlägt Kontakte nach und protokolliert Nachrichten in der Zeitleiste."
      />
      <MailwinView initial={await getMailwinOverview(actor)} />
    </div>
  );
}
