import { route, readBody } from "@/lib/api/route";
import { apiKeyInputSchema, createApiKey, listApiKeys } from "@/server/services/api-keys";

export const GET = route(async ({ ctx }) => listApiKeys(ctx), { permission: "settings.manage" });

/** The plaintext key is in this response only — it is never retrievable again. */
export const POST = route(async ({ req, ctx }) => createApiKey(ctx, await readBody(req, apiKeyInputSchema)), {
  permission: "settings.manage",
});
