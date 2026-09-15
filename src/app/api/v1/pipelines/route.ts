import { route, readBody } from "@/lib/api/route";
import { createPipeline, listPipelines, pipelineInputSchema } from "@/server/services/pipelines";

export const GET = route(async ({ ctx }) => listPipelines(ctx));

export const POST = route(async ({ req, ctx }) => createPipeline(ctx, await readBody(req, pipelineInputSchema)));
