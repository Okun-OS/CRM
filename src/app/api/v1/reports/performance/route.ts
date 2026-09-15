import { route } from "@/lib/api/route";
import { reportRangeSchema, salesPerformance } from "@/server/services/reports";

export const GET = route(async ({ ctx, url }) =>
  salesPerformance(ctx, reportRangeSchema.parse(Object.fromEntries(url.searchParams.entries()))),
);
