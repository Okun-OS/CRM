import { mailwinRoute } from "@/server/mailwin/http";
import { leadCreateSchema } from "@/server/mailwin/schemas";
import { createLead } from "@/server/mailwin/service";

/** Legt einen Lead (im CRM: Deal) an; fehlende Kontakte und Firmen entstehen dabei. */
export const POST = mailwinRoute(async ({ ctx, body }) => {
  const input = leadCreateSchema.parse(body);
  return { status: 201, body: await createLead(ctx, input) };
});
