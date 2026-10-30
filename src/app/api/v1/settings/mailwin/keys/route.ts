import { route, readBody } from "@/lib/api/route";
import { createMailwinKey, mailwinKeyInputSchema } from "@/server/mailwin/settings";

/** Der Klartext steht nur in dieser Antwort — er lässt sich nie wieder abrufen. */
export const POST = route(async ({ req, ctx }) => createMailwinKey(ctx, await readBody(req, mailwinKeyInputSchema)), {
  permission: "settings.manage",
});
