import { route, readBody } from "@/lib/api/route";
import { contactInputSchema } from "@/lib/schemas/crm";
import { createContact, listContacts } from "@/server/services/contacts";
import { readListQuery } from "@/server/services/listing";

export const GET = route(async ({ ctx, url }) => listContacts(ctx, readListQuery(url)));

export const POST = route(async ({ req, ctx }) => createContact(ctx, await readBody(req, contactInputSchema)));
