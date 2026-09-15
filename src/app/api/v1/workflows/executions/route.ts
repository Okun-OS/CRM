import { route } from "@/lib/api/route";
import { executionQuerySchema, listExecutions } from "@/server/services/workflows";

export const GET = route(async ({ ctx, url }) =>
  listExecutions(ctx, executionQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))),
);
