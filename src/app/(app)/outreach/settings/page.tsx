import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { PageHeader } from "@/components/ui/misc";
import { SendingView } from "./sending-view";

export const metadata: Metadata = { title: "Versand" };
export const dynamic = "force-dynamic";

export default async function OutreachSettingsPage() {
  const actor = await getActor();
  if (!actor) return null;
  if (!can(actor, "outreach.settings")) redirect("/outreach");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Versand"
        description="Versandkonten mit ihren Grenzen — und die Kontaktsperre. Menge ist hier kein Ziel."
      />
      <SendingView />
    </div>
  );
}
