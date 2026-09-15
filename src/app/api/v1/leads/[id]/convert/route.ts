import { z } from "zod";
import { route, readBody } from "@/lib/api/route";
import { convertLead } from "@/server/services/leads";

const convertSchema = z.object({
  createDeal: z.boolean().default(true),
  dealName: z.string().trim().max(160).optional(),
  dealAmount: z.coerce.number().min(0).optional(),
  pipelineId: z.string().max(30).optional(),
  stageId: z.string().max(30).optional(),
  companyId: z.string().max(30).optional(),
  contactId: z.string().max(30).optional(),
});

export const POST = route<{ id: string }>(async ({ req, ctx, params }) =>
  convertLead(ctx, params.id, await readBody(req, convertSchema)),
);
