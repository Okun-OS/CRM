import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/misc";
import { InboxView } from "./inbox-view";

export const metadata: Metadata = { title: "Antworten" };
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Antworten"
        description="Eingegangene Antworten, nach Bedeutung sortiert. Die Einstufung sortiert — sie filtert nicht: Nichts verschwindet."
      />
      <InboxView />
    </div>
  );
}
