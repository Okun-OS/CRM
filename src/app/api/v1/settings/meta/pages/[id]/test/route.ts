import { route } from "@/lib/api/route";
import { sendMetaTestNotification } from "@/server/services/meta-settings";

/** Probe-E-Mail an die eingestellten Empfänger. */
export const POST = route<{ id: string }>(async ({ ctx, params }) => sendMetaTestNotification(ctx, params.id), {
  permission: "settings.manage",
});
