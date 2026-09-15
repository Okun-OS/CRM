import { route, readBody } from "@/lib/api/route";
import { deleteView, savedViewSchema, updateView } from "@/server/services/views";

export const PUT = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateView(ctx, params.id, await readBody(req, savedViewSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteView(ctx, params.id);
  return { ok: true };
});
