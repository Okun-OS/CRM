import { route, readBody } from "@/lib/api/route";
import {
  deleteProspect,
  getProspect,
  prospectUpdateSchema,
  updateProspect,
} from "@/server/services/acquisition/prospects";

export const GET = route<{ id: string }>(async ({ ctx, params }) => getProspect(ctx, params.id));

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateProspect(ctx, params.id, await readBody(req, prospectUpdateSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteProspect(ctx, params.id);
});
