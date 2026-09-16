import { route } from "@/lib/api/route";
import { resolveEmailTransport } from "@/server/integrations/email";

/** Tells the UI honestly whether e-mail can be sent right now, and why not. */
export const GET = route(async ({ ctx }) => {
  const resolution = await resolveEmailTransport(ctx);
  return resolution.ok
    ? { connected: true as const, fromAddress: resolution.fromAddress }
    : { connected: false as const, reason: resolution.reason };
});
