import { mailwinRoute } from "@/server/mailwin/http";
import { contactSuggestionSchema, suggestContactChanges } from "@/server/mailwin/actions";

/** Leere Felder werden gefüllt, abweichende Angaben werden zum Vorschlag. */
export const POST = mailwinRoute(async ({ ctx, body, params }) => {
  const input = contactSuggestionSchema.parse(body);
  return { status: 200, body: await suggestContactChanges(ctx, params.id, input) };
});
