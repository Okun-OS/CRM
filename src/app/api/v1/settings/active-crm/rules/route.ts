import { route, readBody } from "@/lib/api/route";
import { ruleSettingSchema, updateRuleSetting } from "@/server/services/active-crm-settings";

export const PUT = route(async ({ req, ctx }) => updateRuleSetting(ctx, await readBody(req, ruleSettingSchema)), {
  permission: "settings.manage",
});
