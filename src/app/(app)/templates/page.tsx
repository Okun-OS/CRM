import type { Metadata } from "next";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { PageHeader } from "@/components/ui/misc";
import { TemplatesView } from "./templates-view";

export const metadata: Metadata = { title: "E-Mail-Vorlagen" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const actor = await getActor();
  if (!actor) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="E-Mail-Vorlagen"
        description="Wiederverwendbare Texte mit Platzhaltern, die beim Versand aus dem Datensatz befüllt werden."
      />
      <TemplatesView canWrite={can(actor, "templates.write")} />
    </div>
  );
}
