import { platformRoute } from "@/lib/api/platform-route";
import { readBody } from "@/lib/api/route";
import { suspendCustomer, suspendSchema } from "@/server/services/platform";

export const POST = platformRoute<{ id: string }>(async ({ req, actor, params }) =>
  suspendCustomer(actor, params.id, await readBody(req, suspendSchema)),
);
