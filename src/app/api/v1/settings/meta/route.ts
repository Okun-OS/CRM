import { route } from "@/lib/api/route";
import { getMetaOverview } from "@/server/services/meta-settings";

/** Alles für die Einstellungsseite: Einrichtung, verbundene Seiten, letzte Leads. */
export const GET = route(async ({ ctx }) => getMetaOverview(ctx), { permission: "settings.manage" });
