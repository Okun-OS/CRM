import { route, readBody } from "@/lib/api/route";
import { createLifecycleStage, listLifecycleStages, optionSchema } from "@/server/services/settings";

export const GET = route(async ({ ctx }) => listLifecycleStages(ctx));

export const POST = route(async ({ req, ctx }) => createLifecycleStage(ctx, await readBody(req, optionSchema)));
