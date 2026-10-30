import { mailwinRoute } from "@/server/mailwin/http";
import { createMailwinTask, taskCreateSchema } from "@/server/mailwin/actions";

/** Legt eine Aufgabe für die Person an, die den Lead bzw. Kontakt betreut; über externalId idempotent. */
export const POST = mailwinRoute(async ({ ctx, body }) => {
  const input = taskCreateSchema.parse(body);
  const result = await createMailwinTask(ctx, input);
  return { status: result.duplicate ? 200 : 201, body: result };
});
