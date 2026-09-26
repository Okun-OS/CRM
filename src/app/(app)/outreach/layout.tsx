import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { OutreachNav } from "./outreach-nav";

/**
 * Die Akquise-Hülle.
 *
 * Wer keine Prospects sehen darf, sieht den Bereich gar nicht — die Prüfung
 * steht hier serverseitig, nicht nur als ausgeblendeter Navigationseintrag.
 */
export default async function OutreachLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!can(actor, "prospects.read")) redirect("/dashboard");

  return (
    <div className="space-y-5">
      <OutreachNav permissions={actor.permissions} />
      {children}
    </div>
  );
}
