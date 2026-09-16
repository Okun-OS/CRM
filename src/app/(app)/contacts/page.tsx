import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { PageHeader } from "@/components/ui/misc";
import { ContactsList } from "./contacts-list";

export const metadata: Metadata = { title: "Kontakte" };
export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Kontakte"
        description="Alle Personen, mit denen dein Unternehmen in Beziehung steht."
      />
      <ContactsList
        canCreate={can(actor, "contacts.write")}
        canDelete={can(actor, "contacts.delete")}
        canExport={can(actor, "exports.run")}
        canImport={can(actor, "imports.run")}
      />
    </div>
  );
}
