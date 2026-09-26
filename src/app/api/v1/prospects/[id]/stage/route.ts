import { route, readBody } from "@/lib/api/route";
import { changeProspectStage, prospectStageSchema } from "@/server/services/acquisition/prospects";

export const POST = route<{ id: string }>(async ({ req, ctx, params }) =>
  changeProspectStage(ctx, params.id, await readBody(req, prospectStageSchema)),
);
