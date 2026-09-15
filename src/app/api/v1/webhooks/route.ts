import { route, readBody } from "@/lib/api/route";
import { createWebhookEndpoint, listWebhookEndpoints, webhookInputSchema } from "@/server/services/webhooks";

export const GET = route(async ({ ctx }) => listWebhookEndpoints(ctx));

/** The signing secret is returned exactly once, on creation. */
export const POST = route(async ({ req, ctx }) => createWebhookEndpoint(ctx, await readBody(req, webhookInputSchema)));
