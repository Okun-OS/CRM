import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { listApiKeys } from "@/server/services/api-keys";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { ApiKeysView } from "./api-keys-view";

export const metadata: Metadata = { title: "API-Keys" };
export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const actor = await getActor();
  if (!actor) return null;

  if (!can(actor, "settings.manage")) {
    return (
      <Card>
        <EmptyState
          title="Keine Berechtigung"
          description="API-Keys dürfen nur Administratorinnen und Administratoren verwalten."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="API-Keys"
        description="Zugänge für andere Systeme – etwa OKUN Deals, das Termine, Angebote und Abschlüsse meldet, damit nichts doppelt erfasst werden muss."
      />
      <ApiKeysView initial={await listApiKeys(actor)} />
    </div>
  );
}
