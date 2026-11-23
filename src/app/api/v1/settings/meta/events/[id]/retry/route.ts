import { route } from "@/lib/api/route";
import { retryMetaLeadEvent } from "@/server/services/meta-settings";

/** Eine gescheiterte Meldung sofort erneut abholen. */
export const POST = route<{ id: string }>(async ({ ctx, params }) => retryMetaLeadEvent(ctx, params.id), {
  permission: "settings.manage",
});
