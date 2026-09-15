import { route } from "@/lib/api/route";
import { importJobQuerySchema, listImportJobs } from "@/server/services/imports";

export const GET = route(async ({ ctx, url }) =>
  listImportJobs(ctx, importJobQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))),
);
