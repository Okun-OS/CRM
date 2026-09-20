import { notFound } from "next/navigation";
import { getPlatformActor } from "@/lib/auth/session";
import { AppError } from "@/lib/api/errors";
import { getCustomer } from "@/server/services/platform";
import { platformMailConfigured } from "@/server/integrations/platform-mail";
import { CustomerDetail } from "./customer-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getPlatformActor();
  if (!actor) return { title: "Kunde" };
  try {
    return { title: (await getCustomer(actor, (await params).id)).name };
  } catch {
    return { title: "Kunde" };
  }
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getPlatformActor();
  if (!actor) return null;

  try {
    const customer = await getCustomer(actor, (await params).id);
    return <CustomerDetail customer={customer} mailConfigured={platformMailConfigured()} />;
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
