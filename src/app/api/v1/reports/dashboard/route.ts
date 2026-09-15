import { route } from "@/lib/api/route";
import { dashboardSummary, pipelineFunnel } from "@/server/services/reports";
import { taskCounts } from "@/server/services/tasks";

export const GET = route(async ({ ctx, url }) => {
  const [summary, funnel, tasks] = await Promise.all([
    dashboardSummary(ctx),
    pipelineFunnel(ctx, url.searchParams.get("pipelineId") ?? undefined),
    taskCounts(ctx),
  ]);
  return { summary, funnel, tasks };
});
