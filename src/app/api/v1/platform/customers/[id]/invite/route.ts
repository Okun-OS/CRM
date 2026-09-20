import { z } from "zod";
import { platformRoute } from "@/lib/api/platform-route";
import { readBody } from "@/lib/api/route";
import { inviteCustomerAdmin } from "@/server/services/platform";

const bodySchema = z.object({
  email: z.string().trim().email("Bitte eine gültige E-Mail-Adresse angeben.").max(254),
  name: z.string().trim().max(80).optional(),
});

export const POST = platformRoute<{ id: string }>(async ({ req, actor, params }) =>
  inviteCustomerAdmin(actor, params.id, await readBody(req, bodySchema)),
);
