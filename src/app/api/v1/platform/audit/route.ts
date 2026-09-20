import { platformRoute } from "@/lib/api/platform-route";
import { listPlatformAudit } from "@/server/services/platform";

export const GET = platformRoute(async ({ actor, url }) =>
  listPlatformAudit(actor, Number(url.searchParams.get("take") ?? 100)),
);
