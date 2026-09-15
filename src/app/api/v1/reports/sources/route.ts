import { route } from "@/lib/api/route";
import { sourceBreakdown } from "@/server/services/reports";

export const GET = route(async ({ ctx }) => sourceBreakdown(ctx));
