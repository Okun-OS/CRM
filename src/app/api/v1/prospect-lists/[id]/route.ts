import { route, readBody } from "@/lib/api/route";
import {
  archiveProspectList,
  getProspectList,
  prospectListInputSchema,
  updateProspectList,
} from "@/server/services/acquisition/lists";

export const GET = route<{ id: string }>(async ({ ctx, params }) => getProspectList(ctx, params.id));

export const PUT = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateProspectList(ctx, params.id, await readBody(req, prospectListInputSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await archiveProspectList(ctx, params.id);
});
