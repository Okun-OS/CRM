import { route } from "@/lib/api/route";
import { listIntegrations } from "@/server/services/settings";

/** Catalogue + connection state. Nothing here is presented as connected unless it is. */
export const GET = route(async ({ ctx }) => listIntegrations(ctx));
