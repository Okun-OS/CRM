import { route, readBody } from "@/lib/api/route";
import { getOrganization, organizationSettingsSchema, updateOrganization } from "@/server/services/organizations";

export const GET = route(async ({ ctx }) => getOrganization(ctx));

export const PATCH = route(async ({ req, ctx }) =>
  updateOrganization(ctx, await readBody(req, organizationSettingsSchema)),
);
