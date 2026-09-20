import { route } from "@/lib/api/route";
import { listConnections } from "@/server/services/integrations";

export const GET = route(async ({ ctx }) => listConnections(ctx), { permission: "settings.manage" });
