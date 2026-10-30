import { route } from "@/lib/api/route";
import { rejectSuggestion } from "@/server/services/suggestions";

export const POST = route<{ id: string }>(async ({ ctx, params }) => rejectSuggestion(ctx, params.id));
