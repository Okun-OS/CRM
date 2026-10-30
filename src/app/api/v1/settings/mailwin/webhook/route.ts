import { route, readBody } from "@/lib/api/route";
import { mailwinWebhookInputSchema, saveMailwinWebhook } from "@/server/mailwin/settings";

/** Ein vom CRM erzeugtes Geheimnis steht nur in dieser Antwort. */
export const PUT = route(async ({ req, ctx }) => saveMailwinWebhook(ctx, await readBody(req, mailwinWebhookInputSchema)), {
  permission: "settings.manage",
});
