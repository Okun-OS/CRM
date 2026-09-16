import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { findCompanyDuplicates, findContactDuplicates } from "@/server/services/duplicates";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { DuplicatesView } from "./duplicates-view";

export const metadata: Metadata = { title: "Duplikate" };
export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "contacts.read")) {
    return (
      <Card>
        <EmptyState title="Keine Berechtigung" description="Für die Duplikatprüfung fehlt dir die Berechtigung." />
      </Card>
    );
  }

  const [contacts, companies] = await Promise.all([findContactDuplicates(actor), findCompanyDuplicates(actor)]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Duplikate"
        description="Mögliche Dubletten werden konservativ erkannt – zusammengeführt wird nur nach ausdrücklicher Bestätigung."
      />
      <DuplicatesView
        contactGroups={contacts}
        companyGroups={companies}
        canMerge={can(actor, "contacts.write") && can(actor, "contacts.delete")}
      />
    </div>
  );
}
