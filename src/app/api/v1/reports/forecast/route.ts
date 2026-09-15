import { route } from "@/lib/api/route";
import { reportRangeSchema, salesForecast } from "@/server/services/reports";

export const GET = route(async ({ ctx, url }) =>
  salesForecast(ctx, reportRangeSchema.parse(Object.fromEntries(url.searchParams.entries()))),
);
