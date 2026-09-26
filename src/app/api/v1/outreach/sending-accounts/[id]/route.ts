import { z } from "zod";
import { route, readBody } from "@/lib/api/route";
import {
  deleteSendingAccount,
  pauseSendingAccount,
  resumeSendingAccount,
  sendingAccountInputSchema,
  updateSendingAccount,
} from "@/server/services/acquisition/sending-accounts";

export const PUT = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateSendingAccount(ctx, params.id, await readBody(req, sendingAccountInputSchema)),
);

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause"), reason: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("resume") }),
]);

export const POST = route<{ id: string }>(async ({ req, ctx, params }) => {
  const body = await readBody(req, actionSchema);
  return body.action === "pause"
    ? pauseSendingAccount(ctx, params.id, body.reason)
    : resumeSendingAccount(ctx, params.id);
});

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteSendingAccount(ctx, params.id);
});
