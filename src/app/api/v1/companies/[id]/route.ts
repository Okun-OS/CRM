import { route, readBody } from "@/lib/api/route";
import { companyUpdateSchema } from "@/lib/schemas/crm";
import { deleteCompany, getCompany, updateCompany } from "@/server/services/companies";

export const GET = route<{ id: string }>(async ({ ctx, params }) => getCompany(ctx, params.id));

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateCompany(ctx, params.id, await readBody(req, companyUpdateSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteCompany(ctx, params.id);
  return { ok: true };
});
