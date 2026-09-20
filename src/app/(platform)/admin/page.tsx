import { getPlatformActor } from "@/lib/auth/session";
import { listCustomers, platformOverview } from "@/server/services/platform";
import { platformMailConfigured } from "@/server/integrations/platform-mail";
import { CustomersView } from "./customers-view";

export const metadata = { title: "Kunden" };
export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const actor = await getPlatformActor();
  if (!actor) return null;

  const [overview, customers] = await Promise.all([platformOverview(actor), listCustomers(actor)]);

  return (
    <CustomersView
      overview={overview}
      initialCustomers={customers}
      mailConfigured={platformMailConfigured()}
    />
  );
}
