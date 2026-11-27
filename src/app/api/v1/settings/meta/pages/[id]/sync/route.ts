import { route } from "@/lib/api/route";
import { syncMetaPage } from "@/server/services/meta-settings";

/** Sofort bei Meta nach neuen Einsendungen fragen. */
export const POST = route<{ id: string }>(async ({ ctx, params }) => syncMetaPage(ctx, params.id), {
  permission: "settings.manage",
});
