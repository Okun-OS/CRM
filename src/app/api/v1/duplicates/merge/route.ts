import { z } from "zod";
import { route, readBody } from "@/lib/api/route";
import { mergeCompanies, mergeContacts } from "@/server/services/duplicates";

const mergeSchema = z.object({
  objectType: z.enum(["CONTACT", "COMPANY"]),
  primaryId: z.string().min(1).max(30),
  duplicateId: z.string().min(1).max(30),
});

export const POST = route(async ({ req, ctx }) => {
  const body = await readBody(req, mergeSchema);
  return body.objectType === "CONTACT"
    ? mergeContacts(ctx, body.primaryId, body.duplicateId)
    : mergeCompanies(ctx, body.primaryId, body.duplicateId);
});
