import { route } from "@/lib/api/route";
import { sendMailwinTestWebhook } from "@/server/mailwin/webhooks";

/** Sendet ein `ping` an Mailwin und meldet das Ergebnis sofort. */
export const POST = route(async ({ ctx }) => sendMailwinTestWebhook(ctx), {
  permission: "settings.manage",
  rateLimit: { limit: 10, windowMs: 60_000 },
});
