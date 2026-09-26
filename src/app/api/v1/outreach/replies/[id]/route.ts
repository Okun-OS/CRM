import { z } from "zod";
import { route, readBody } from "@/lib/api/route";
import {
  markReplyReviewed,
  reclassifyReply,
  reclassifySchema,
  recordBounce,
} from "@/server/services/acquisition/replies";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reclassify") }).merge(reclassifySchema),
  z.object({ action: z.literal("reviewed") }),
  z.object({ action: z.literal("bounce"), reason: z.string().trim().min(1).max(300) }),
]);

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => {
  const body = await readBody(req, schema);
  if (body.action === "reclassify") return reclassifyReply(ctx, params.id, { classification: body.classification });
  if (body.action === "bounce") return recordBounce(ctx, params.id, body.reason);
  await markReplyReviewed(ctx, params.id);
  return { id: params.id, reviewed: true };
});
