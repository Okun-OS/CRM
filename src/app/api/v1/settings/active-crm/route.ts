import { route, readBody } from "@/lib/api/route";
import {
  activeCrmSettingsSchema,
  getActiveCrmConfiguration,
  updateActiveCrmSettings,
} from "@/server/services/active-crm-settings";

export const GET = route(async ({ ctx }) => getActiveCrmConfiguration(ctx));

export const PUT = route(
  async ({ req, ctx }) => updateActiveCrmSettings(ctx, await readBody(req, activeCrmSettingsSchema)),
  { permission: "settings.manage" },
);
