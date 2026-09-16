import { route, readBody } from "@/lib/api/route";
import { dismissNextAction, dismissSchema } from "@/server/services/next-actions";

export const POST = route<{ id: string }>(async ({ req, ctx, params }) =>
  dismissNextAction(ctx, params.id, await readBody(req, dismissSchema)),
);
