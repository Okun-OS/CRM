import { route } from "@/lib/api/route";
import { acceptSuggestion } from "@/server/services/suggestions";

/** Führt einen Vorschlag aus (z. B. „Als gewonnen markieren“). Das Recht prüft der Service je Art. */
export const POST = route<{ id: string }>(async ({ ctx, params }) => acceptSuggestion(ctx, params.id));
