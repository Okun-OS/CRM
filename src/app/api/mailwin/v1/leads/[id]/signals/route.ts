import { mailwinRoute } from "@/server/mailwin/http";
import { processSignal, signalInputSchema } from "@/server/mailwin/signals";

/** Mailwin meldet, was es erkannt hat; das CRM entscheidet, was daraus folgt. */
export const POST = mailwinRoute(async ({ ctx, body, params }) => {
  const input = signalInputSchema.parse(body);
  const outcome = await processSignal(ctx, params.id, input);
  return { status: outcome.duplicate ? 200 : 201, body: outcome };
});
