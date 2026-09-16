import { route, readBody } from "@/lib/api/route";
import { manualNextActionSchema, setManualNextAction } from "@/server/services/next-actions";
import { parseRecordRef } from "@/lib/api/record-ref";

/** A next action the user defines by hand; it overrides the engine's proposal. */
export const PUT = route<{ kind: string; id: string }>(async ({ req, ctx, params }) =>
  setManualNextAction(ctx, parseRecordRef(params), await readBody(req, manualNextActionSchema)),
);
