import { mailwinRoute } from "@/server/mailwin/http";
import { createMailwinTask, taskCreateSchema } from "@/server/mailwin/actions";

/** Legt eine Aufgabe für die Person an, die den Lead bzw. Kontakt betreut. */
export const POST = mailwinRoute(async ({ ctx, body }) => {
  const input = taskCreateSchema.parse(body);
  return { status: 201, body: await createMailwinTask(ctx, input) };
});
