import { route, readBody } from "@/lib/api/route";
import { memberUpdateSchema, removeMember, updateMember } from "@/server/services/users";

export const PATCH = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateMember(ctx, params.id, await readBody(req, memberUpdateSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await removeMember(ctx, params.id);
  return { ok: true };
});
