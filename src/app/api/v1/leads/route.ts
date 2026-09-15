import { route, readBody } from "@/lib/api/route";
import { leadInputSchema } from "@/lib/schemas/crm";
import { createLead, listLeads } from "@/server/services/leads";
import { readListQuery } from "@/server/services/listing";

export const GET = route(async ({ ctx, url }) => listLeads(ctx, readListQuery(url)));

export const POST = route(async ({ req, ctx }) => createLead(ctx, await readBody(req, leadInputSchema)));
