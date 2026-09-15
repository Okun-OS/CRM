import { route, readBody } from "@/lib/api/route";
import { companyInputSchema } from "@/lib/schemas/crm";
import { createCompany, listCompanies } from "@/server/services/companies";
import { readListQuery } from "@/server/services/listing";

export const GET = route(async ({ ctx, url }) => listCompanies(ctx, readListQuery(url)));

export const POST = route(async ({ req, ctx }) => createCompany(ctx, await readBody(req, companyInputSchema)));
