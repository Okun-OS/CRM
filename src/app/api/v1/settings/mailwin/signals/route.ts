import { route, readBody } from "@/lib/api/route";
import { saveSignalSettings, signalConfigSchema } from "@/server/mailwin/signal-settings";

/** Wie der Arbeitsbereich auf Mailwin-Signale reagiert (Phasen, Gewonnen/Verloren, Angebotswert). */
export const PUT = route(async ({ req, ctx }) => saveSignalSettings(ctx, await readBody(req, signalConfigSchema)), {
  permission: "settings.manage",
});
