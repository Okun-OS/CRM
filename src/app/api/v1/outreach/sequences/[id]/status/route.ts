import { z } from "zod";
import { route, readBody } from "@/lib/api/route";
import { setSequenceStatus } from "@/server/services/acquisition/sequences";

const schema = z.object({ status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]) });

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => {
  const body = await readBody(req, schema);
  return setSequenceStatus(ctx, params.id, body.status);
});
