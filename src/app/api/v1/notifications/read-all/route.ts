import { route } from "@/lib/api/route";
import { markAllNotificationsRead } from "@/server/services/notifications";

export const POST = route(async ({ ctx }) => {
  await markAllNotificationsRead(ctx);
  return { ok: true };
});
