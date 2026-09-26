import { route, readBody } from "@/lib/api/route";
import { listRepliesForReview, recordReply, replyInputSchema } from "@/server/services/acquisition/replies";

export const GET = route(async ({ ctx, url }) =>
  listRepliesForReview(ctx, { onlyOpen: url.searchParams.get("open") === "true" }),
);

export const POST = route(async ({ req, ctx }) => recordReply(ctx, await readBody(req, replyInputSchema)));
