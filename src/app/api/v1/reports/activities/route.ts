import { route } from "@/lib/api/route";
import { activityBreakdown, dealsOverTime, reportRangeSchema } from "@/server/services/reports";

export const GET = route(async ({ ctx, url }) => {
  const range = reportRangeSchema.parse(Object.fromEntries(url.searchParams.entries()));
  const [activities, deals] = await Promise.all([activityBreakdown(ctx, range), dealsOverTime(ctx, range)]);
  return { activities, deals };
});
