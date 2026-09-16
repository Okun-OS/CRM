import type { Metadata } from "next";
import Link from "next/link";
import { KanbanSquare } from "lucide-react";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { getOrganization } from "@/server/services/organizations";
import { DealsList } from "./deals-list";

export const metadata: Metadata = { title: "Deals" };
export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const actor = await getActor();
  if (!actor) return null;
  const organization = await getOrganization(actor);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Deals"
        description="Alle Verkaufschancen mit Wert, Stage und erwartetem Abschluss."
        actions={
          <Link href="/pipeline">
            <Button variant="secondary" icon={<KanbanSquare className="h-4 w-4" />}>
              Pipeline-Ansicht
            </Button>
          </Link>
        }
      />
      <DealsList
        currency={organization?.currency ?? "EUR"}
        canCreate={can(actor, "deals.write")}
        canDelete={can(actor, "deals.delete")}
        canExport={can(actor, "exports.run")}
      />
    </div>
  );
}
