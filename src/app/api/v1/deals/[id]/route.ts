import { route, readBody } from "@/lib/api/route";
import { dealUpdateSchema } from "@/lib/schemas/crm";
import { deleteDeal, getDeal, updateDeal } from "@/server/services/deals";

export const GET = route<{ id: string }>(async ({ ctx, params }) => getDeal(ctx, params.id));

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateDeal(ctx, params.id, await readBody(req, dealUpdateSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteDeal(ctx, params.id);
  return { ok: true };
});
