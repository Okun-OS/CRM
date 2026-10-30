import { mailwinRoute } from "@/server/mailwin/http";
import { outreachReplySchema, recordMailwinReply } from "@/server/mailwin/actions";

/** Von Mailwin eingestufte Antwort auf eine Akquise-Sequenz; über messageId idempotent. */
export const POST = mailwinRoute(async ({ ctx, body }) => {
  const input = outreachReplySchema.parse(body);
  const result = await recordMailwinReply(ctx, input);
  return { status: result.duplicate ? 200 : 201, body: result };
});
