import { route, readBody } from "@/lib/api/route";
import { connectSmtp, smtpConnectionSchema } from "@/server/services/integrations";

/** Prüft die Zugangsdaten und legt die Verbindung nur an, wenn sie tragen. */
export const PUT = route(async ({ req, ctx }) => connectSmtp(ctx, await readBody(req, smtpConnectionSchema)), {
  permission: "settings.manage",
});
