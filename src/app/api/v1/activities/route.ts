import { route, readBody } from "@/lib/api/route";
import { activityInputSchema } from "@/lib/schemas/crm";
import { activityListQuerySchema, createActivity, listActivities } from "@/server/services/activities";

export const GET = route(async ({ ctx, url }) => {
  const types = url.searchParams.getAll("type");
  const query = activityListQuerySchema.parse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
    contactId: url.searchParams.get("contactId") ?? undefined,
    companyId: url.searchParams.get("companyId") ?? undefined,
    dealId: url.searchParams.get("dealId") ?? undefined,
    leadId: url.searchParams.get("leadId") ?? undefined,
    ownerId: url.searchParams.get("ownerId") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    types: types.length > 0 ? types : undefined,
  });
  return listActivities(ctx, query);
});

export const POST = route(async ({ req, ctx }) => createActivity(ctx, await readBody(req, activityInputSchema)));
