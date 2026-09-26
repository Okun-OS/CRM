import { route, readBody } from "@/lib/api/route";
import { addSuppression, listSuppression, suppressionInputSchema } from "@/server/services/acquisition/suppression";

export const GET = route(async ({ ctx }) => listSuppression(ctx));

export const POST = route(async ({ req, ctx }) => addSuppression(ctx, await readBody(req, suppressionInputSchema)));
