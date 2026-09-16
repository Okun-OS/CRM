import { route, readBody } from "@/lib/api/route";
import { snoozeNextAction, snoozeSchema } from "@/server/services/next-actions";

export const POST = route<{ id: string }>(async ({ req, ctx, params }) =>
  snoozeNextAction(ctx, params.id, await readBody(req, snoozeSchema)),
);
