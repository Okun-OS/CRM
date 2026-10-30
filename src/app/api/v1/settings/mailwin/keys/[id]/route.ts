import { route } from "@/lib/api/route";
import { revokeMailwinKey } from "@/server/mailwin/settings";

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => revokeMailwinKey(ctx, params.id), {
  permission: "settings.manage",
});
