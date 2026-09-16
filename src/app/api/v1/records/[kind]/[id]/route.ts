import { route } from "@/lib/api/route";
import { getRecordActionState } from "@/server/services/next-actions";
import { parseRecordRef } from "@/lib/api/record-ref";

/** Everything the engine knows about one record: state, reasoning, history. */
export const GET = route<{ kind: string; id: string }>(async ({ ctx, params }) =>
  getRecordActionState(ctx, parseRecordRef(params)),
);
