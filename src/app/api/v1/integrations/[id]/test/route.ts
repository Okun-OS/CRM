import { route } from "@/lib/api/route";
import { testConnection } from "@/server/services/integrations";

export const POST = route<{ id: string }>(async ({ ctx, params }) => testConnection(ctx, params.id), {
  permission: "settings.manage",
});
