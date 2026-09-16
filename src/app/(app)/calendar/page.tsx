import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { PageHeader } from "@/components/ui/misc";
import { CalendarView } from "./calendar-view";

export const metadata: Metadata = { title: "Kalender" };
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Kalender"
        description="CRM-Termine mit Kontakt-, Unternehmens- und Deal-Bezug. Externe Kalender können später über Integrationen verbunden werden."
      />
      <CalendarView canWrite={can(actor, "meetings.write")} />
    </div>
  );
}
