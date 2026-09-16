import { z } from "zod";
import { route, readBody } from "@/lib/api/route";
import {
  cancelRecordAutomation,
  pauseRecordAutomation,
  pauseSchema,
  resumeRecordAutomation,
} from "@/server/services/next-actions";
import { parseRecordRef } from "@/lib/api/record-ref";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause"), until: z.coerce.date(), reason: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("cancel"), automationId: z.string().min(1).max(30), reason: z.string().trim().max(300).default("") }),
]);

/** Manual override of the running automation — always with a traceable reason. */
export const POST = route<{ kind: string; id: string }>(async ({ req, ctx, params }) => {
  const ref = parseRecordRef(params);
  const body = await readBody(req, actionSchema);

  if (body.action === "pause") return pauseRecordAutomation(ctx, ref, pauseSchema.parse(body));
  if (body.action === "resume") return resumeRecordAutomation(ctx, ref);
  return cancelRecordAutomation(ctx, ref, body.automationId, body.reason);
});
