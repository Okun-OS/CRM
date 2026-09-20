import { platformRoute } from "@/lib/api/platform-route";
import { readBody } from "@/lib/api/route";
import { createCustomer, customerInputSchema, listCustomers } from "@/server/services/platform";

export const GET = platformRoute(async ({ actor, url }) =>
  listCustomers(actor, url.searchParams.get("search") ?? undefined),
);

/** Legt eine Kundenorganisation samt Einladung für ihre erste Ansprechperson an. */
export const POST = platformRoute(async ({ req, actor }) =>
  createCustomer(actor, await readBody(req, customerInputSchema)),
);
