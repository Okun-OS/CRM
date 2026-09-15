import { route } from "@/lib/api/route";
import { pipelineFunnel } from "@/server/services/reports";

export const GET = route(async ({ ctx, url }) => pipelineFunnel(ctx, url.searchParams.get("pipelineId") ?? undefined));
