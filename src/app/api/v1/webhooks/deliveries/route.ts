import { route } from "@/lib/api/route";
import { deliveryQuerySchema, listWebhookDeliveries } from "@/server/services/webhooks";

export const GET = route(async ({ ctx, url }) =>
  listWebhookDeliveries(ctx, deliveryQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))),
);
