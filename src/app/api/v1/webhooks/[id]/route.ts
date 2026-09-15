import { route, readBody } from "@/lib/api/route";
import { deleteWebhookEndpoint, updateWebhookEndpoint, webhookInputSchema } from "@/server/services/webhooks";

export const PUT = route<{ id: string }>(async ({ req, ctx, params }) => {
  await updateWebhookEndpoint(ctx, params.id, await readBody(req, webhookInputSchema));
  return { ok: true };
});

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteWebhookEndpoint(ctx, params.id);
  return { ok: true };
});
