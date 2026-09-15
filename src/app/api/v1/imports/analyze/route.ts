import { route, readBody } from "@/lib/api/route";
import { analyzeImport, importAnalyzeSchema } from "@/server/services/imports";

export const POST = route(async ({ req, ctx }) => analyzeImport(ctx, await readBody(req, importAnalyzeSchema)));
