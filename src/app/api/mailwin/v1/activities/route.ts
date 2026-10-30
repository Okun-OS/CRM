import { mailwinRoute } from "@/server/mailwin/http";
import { activityCreateSchema } from "@/server/mailwin/schemas";
import { createMailwinActivity } from "@/server/mailwin/service";

/** Protokolliert eine Nachricht in der Zeitleiste; über `externalId` idempotent. */
export const POST = mailwinRoute(async ({ ctx, body }) => {
  const input = activityCreateSchema.parse(body);
  const { id, created } = await createMailwinActivity(ctx, input);
  return { status: created ? 201 : 200, body: { id } };
});
