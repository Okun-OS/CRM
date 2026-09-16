import { route } from "@/lib/api/route";
import { actionCenterQuerySchema, getActionCenter } from "@/server/services/next-actions";

/** The "Heute" screen: everything open, sorted into the buckets of a sales day. */
export const GET = route(async ({ ctx, url }) =>
  getActionCenter(
    ctx,
    actionCenterQuerySchema.parse({
      ownerId: url.searchParams.get("ownerId") ?? undefined,
      scope: url.searchParams.get("scope") ?? undefined,
    }),
  ),
);
