import { mailwinRoute } from "@/server/mailwin/http";
import { getWorkspace } from "@/server/mailwin/service";

/** Prüft den Schlüssel und nennt den Arbeitsbereich, zu dem er gehört. */
export const GET = mailwinRoute(async ({ ctx }) => ({ status: 200, body: await getWorkspace(ctx) }));
