import { route } from "@/lib/api/route";
import { listNotifications, notificationQuerySchema } from "@/server/services/notifications";

export const GET = route(async ({ ctx, url }) =>
  listNotifications(ctx, notificationQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))),
);
