import { route } from "@/lib/api/route";
import { disconnectIntegration } from "@/server/services/integrations";

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => disconnectIntegration(ctx, params.id), {
  permission: "settings.manage",
});
