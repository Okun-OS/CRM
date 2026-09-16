import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { can } from "@/lib/context";

export const metadata: Metadata = { title: "Einstellungen" };

/** The settings root sends each role to the first section it may open. */
export default async function SettingsPage() {
  const actor = await getActor();
  if (!actor) return null;
  redirect(can(actor, "organization.manage") ? "/settings/organization" : "/settings/profile");
}
