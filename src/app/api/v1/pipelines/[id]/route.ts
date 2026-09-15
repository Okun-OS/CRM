import { route, readBody } from "@/lib/api/route";
import { archivePipeline, pipelineInputSchema, updatePipeline } from "@/server/services/pipelines";

export const PUT = route<{ id: string }>(async ({ req, ctx, params }) =>
  updatePipeline(ctx, params.id, await readBody(req, pipelineInputSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await archivePipeline(ctx, params.id);
  return { ok: true };
});
