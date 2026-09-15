import { route, readBody } from "@/lib/api/route";
import { contactUpdateSchema } from "@/lib/schemas/crm";
import { deleteContact, getContact, updateContact } from "@/server/services/contacts";

export const GET = route<{ id: string }>(async ({ ctx, params }) => getContact(ctx, params.id));

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateContact(ctx, params.id, await readBody(req, contactUpdateSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteContact(ctx, params.id);
  return { ok: true };
});
