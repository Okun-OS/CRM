import { route, readBody } from "@/lib/api/route";
import { dealInputSchema } from "@/lib/schemas/crm";
import { createDeal, listDeals } from "@/server/services/deals";
import { readListQuery } from "@/server/services/listing";

export const GET = route(async ({ ctx, url }) => listDeals(ctx, readListQuery(url)));

export const POST = route(async ({ req, ctx }) => createDeal(ctx, await readBody(req, dealInputSchema)));
