import { route, readBody } from "@/lib/api/route";
import {
  createProspect,
  listProspects,
  prospectInputSchema,
  prospectListQuerySchema,
} from "@/server/services/acquisition/prospects";

export const GET = route(async ({ ctx, url }) =>
  listProspects(ctx, prospectListQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))),
);

export const POST = route(async ({ req, ctx }) => createProspect(ctx, await readBody(req, prospectInputSchema)));
