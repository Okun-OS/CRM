import { route, readBody } from "@/lib/api/route";
import { createSequence, listSequences, sequenceInputSchema } from "@/server/services/acquisition/sequences";

export const GET = route(async ({ ctx }) => listSequences(ctx));
export const POST = route(async ({ req, ctx }) => createSequence(ctx, await readBody(req, sequenceInputSchema)));
