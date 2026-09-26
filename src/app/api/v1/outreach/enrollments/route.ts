import { route, readBody } from "@/lib/api/route";
import { enrollInputSchema, enrollProspects, listEnrollments } from "@/server/services/acquisition/enrollment";

export const GET = route(async ({ ctx, url }) =>
  listEnrollments(ctx, {
    sequenceId: url.searchParams.get("sequenceId") ?? undefined,
    prospectId: url.searchParams.get("prospectId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  }),
);

export const POST = route(async ({ req, ctx }) => enrollProspects(ctx, await readBody(req, enrollInputSchema)));
