import { route, readBody } from "@/lib/api/route";
import { importRunSchema, runImport } from "@/server/services/imports";

export const POST = route(async ({ req, ctx }) => runImport(ctx, await readBody(req, importRunSchema)), {
  rateLimit: { limit: 10, windowMs: 60 * 60 * 1000, scope: "imports:run" },
});
