import { route, readBody } from "@/lib/api/route";
import { dealStageChangeSchema } from "@/lib/schemas/crm";
import { changeDealStage } from "@/server/services/deals";

/** Used by the pipeline board's drag & drop — the move is persisted server-side. */
export const POST = route<{ id: string }>(async ({ req, ctx, params }) =>
  changeDealStage(ctx, params.id, await readBody(req, dealStageChangeSchema)),
);
