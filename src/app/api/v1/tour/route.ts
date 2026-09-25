import { route, readBody } from "@/lib/api/route";
import { getTourState, tourUpdateSchema, updateTourState } from "@/server/services/tour";

export const GET = route(async ({ ctx }) => getTourState(ctx));

export const PUT = route(async ({ req, ctx }) => updateTourState(ctx, await readBody(req, tourUpdateSchema)));
