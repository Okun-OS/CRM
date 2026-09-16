import { route, readBody } from "@/lib/api/route";
import { recallSchema, setRecall } from "@/server/services/next-actions";
import { parseRecordRef } from "@/lib/api/record-ref";

/** "Melden Sie sich im November" — the system keeps the date. */
export const POST = route<{ kind: string; id: string }>(async ({ req, ctx, params }) =>
  setRecall(ctx, parseRecordRef(params), await readBody(req, recallSchema)),
);
