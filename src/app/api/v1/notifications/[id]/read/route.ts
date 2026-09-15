import { route } from "@/lib/api/route";
import { markNotificationRead } from "@/server/services/notifications";

export const POST = route<{ id: string }>(async ({ ctx, params }) => {
  await markNotificationRead(ctx, params.id);
  return { ok: true };
});
