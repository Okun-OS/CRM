import { mailwinRoute } from "@/server/mailwin/http";
import { invalidRequest } from "@/server/mailwin/errors";
import { contactQuerySchema, contactUpsertSchema } from "@/server/mailwin/schemas";
import { findContactsByEmail, upsertContact } from "@/server/mailwin/service";

/** Kontakte zu einer E-Mail-Adresse (Groß-/Kleinschreibung egal). */
export const GET = mailwinRoute(async ({ ctx, url }) => {
  const parsed = contactQuerySchema.safeParse({ email: url.searchParams.get("email") ?? undefined });
  if (!parsed.success) throw invalidRequest("Der Parameter „email“ fehlt oder ist keine gültige E-Mail-Adresse.");
  return { status: 200, body: await findContactsByEmail(ctx, parsed.data.email) };
});

/** Legt einen Kontakt an oder ergänzt den bestehenden (Abgleich über die E-Mail-Adresse). */
export const POST = mailwinRoute(async ({ ctx, body }) => {
  const input = contactUpsertSchema.parse(body);
  const { contact, created } = await upsertContact(ctx, input);
  return { status: created ? 201 : 200, body: contact };
});
