import { route, readBody } from "@/lib/api/route";
import { leadUpdateSchema } from "@/lib/schemas/crm";
import { deleteLead, getLead, updateLead } from "@/server/services/leads";

export const GET = route<{ id: string }>(async ({ ctx, params }) => getLead(ctx, params.id));

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateLead(ctx, params.id, await readBody(req, leadUpdateSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteLead(ctx, params.id);
  return { ok: true };
});
