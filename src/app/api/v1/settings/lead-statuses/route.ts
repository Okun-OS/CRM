import { route, readBody } from "@/lib/api/route";
import { createLeadStatus, listLeadStatuses, optionSchema } from "@/server/services/settings";

export const GET = route(async ({ ctx }) => listLeadStatuses(ctx));

export const POST = route(async ({ req, ctx }) => createLeadStatus(ctx, await readBody(req, optionSchema)));
