import { mailwinRoute } from "@/server/mailwin/http";
import { getLeadContext } from "@/server/mailwin/actions";

/** Kontext zu einem Lead — Phase, nächste Aktion, offene Aufgaben, letzte Nachrichten. */
export const GET = mailwinRoute(async ({ ctx, params }) => ({ status: 200, body: await getLeadContext(ctx, params.id) }));
