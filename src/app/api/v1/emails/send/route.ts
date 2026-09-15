import { route, readBody } from "@/lib/api/route";
import { emailComposeSchema, sendEmail } from "@/server/services/emails";

/**
 * Fails with INTEGRATION_NOT_CONNECTED (409) while no e-mail transport is
 * connected — the message is kept as a draft in that case.
 */
export const POST = route(async ({ req, ctx }) => sendEmail(ctx, await readBody(req, emailComposeSchema)), {
  rateLimit: { limit: 60, windowMs: 60 * 60 * 1000, scope: "emails:send" },
});
