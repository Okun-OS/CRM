import { route } from "@/lib/api/route";
import { dealCycleTimes } from "@/server/services/reports";

export const GET = route(async ({ ctx }) => dealCycleTimes(ctx));
