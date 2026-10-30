import { route } from "@/lib/api/route";
import { getMailwinOverview } from "@/server/mailwin/settings";

/** Alles für die Einstellungsseite: Schlüssel, Webhook, Aufruf- und Zustellprotokoll. */
export const GET = route(async ({ ctx }) => getMailwinOverview(ctx), { permission: "settings.manage" });
