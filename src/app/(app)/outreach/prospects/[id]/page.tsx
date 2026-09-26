import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";
import { getProspect } from "@/server/services/acquisition/prospects";
import { ProspectDetail } from "./prospect-detail";

export const metadata: Metadata = { title: "Prospect" };
export const dynamic = "force-dynamic";

export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return null;

  const { id } = await params;
  const prospect = await getProspect(actor, id).catch(() => null);
  if (!prospect) notFound();

  return (
    <ProspectDetail
      prospect={prospect}
      canWrite={can(actor, "prospects.write")}
      canEnroll={can(actor, "outreach.enroll")}
    />
  );
}
