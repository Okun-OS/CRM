import { route, readBody } from "@/lib/api/route";
import { deleteDefinition, propertyUpdateSchema, updateDefinition } from "@/server/services/property-definitions";

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateDefinition(ctx, params.id, await readBody(req, propertyUpdateSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteDefinition(ctx, params.id);
  return { ok: true };
});
