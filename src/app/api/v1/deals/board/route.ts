import { route } from "@/lib/api/route";
import { getPipelineBoard } from "@/server/services/deals";

export const GET = route(async ({ ctx, url }) =>
  getPipelineBoard(ctx, url.searchParams.get("pipelineId") ?? undefined),
);
