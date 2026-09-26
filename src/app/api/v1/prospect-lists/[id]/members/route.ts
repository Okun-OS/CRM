import { z } from "zod";
import { route, readBody } from "@/lib/api/route";
import { setListMembers } from "@/server/services/acquisition/lists";

const membersSchema = z.object({
  prospectIds: z.array(z.string().max(30)).min(1).max(500),
  mode: z.enum(["add", "remove"]).default("add"),
});

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => {
  const body = await readBody(req, membersSchema);
  return setListMembers(ctx, params.id, body.prospectIds, body.mode);
});
