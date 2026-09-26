import { route, readBody } from "@/lib/api/route";
import {
  createProspectList,
  listProspectLists,
  prospectListInputSchema,
} from "@/server/services/acquisition/lists";

export const GET = route(async ({ ctx }) => listProspectLists(ctx));

export const POST = route(async ({ req, ctx }) =>
  createProspectList(ctx, await readBody(req, prospectListInputSchema)),
);
