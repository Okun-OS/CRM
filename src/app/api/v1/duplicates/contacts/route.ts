import { route } from "@/lib/api/route";
import { findContactDuplicates } from "@/server/services/duplicates";

export const GET = route(async ({ ctx }) => findContactDuplicates(ctx));
