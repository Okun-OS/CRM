import { route } from "@/lib/api/route";
import { revokeApiKey } from "@/server/services/api-keys";

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => revokeApiKey(ctx, params.id), {
  permission: "settings.manage",
});
