import { route, readBody } from "@/lib/api/route";
import { getSequence, sequenceInputSchema, updateSequence } from "@/server/services/acquisition/sequences";

export const GET = route<{ id: string }>(async ({ ctx, params }) => getSequence(ctx, params.id));
export const PUT = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateSequence(ctx, params.id, await readBody(req, sequenceInputSchema)),
);
