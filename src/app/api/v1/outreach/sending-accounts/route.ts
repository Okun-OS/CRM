import { route, readBody } from "@/lib/api/route";
import {
  createSendingAccount,
  listSendingAccounts,
  sendingAccountInputSchema,
} from "@/server/services/acquisition/sending-accounts";

export const GET = route(async ({ ctx }) => listSendingAccounts(ctx));
export const POST = route(async ({ req, ctx }) =>
  createSendingAccount(ctx, await readBody(req, sendingAccountInputSchema)),
);
