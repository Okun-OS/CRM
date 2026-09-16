import { z } from "zod";
import { route, readBody } from "@/lib/api/route";
import { completeNextAction } from "@/server/services/next-actions";

const bodySchema = z.object({ note: z.string().trim().max(500).optional() });

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => {
  const body = await readBody(req, bodySchema);
  return completeNextAction(ctx, params.id, body.note);
});
