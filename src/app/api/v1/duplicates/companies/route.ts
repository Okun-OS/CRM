import { route } from "@/lib/api/route";
import { findCompanyDuplicates } from "@/server/services/duplicates";

export const GET = route(async ({ ctx }) => findCompanyDuplicates(ctx));
