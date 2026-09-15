import { route, readBody } from "@/lib/api/route";
import { deleteTemplate, templateInputSchema, updateTemplate } from "@/server/services/emails";

export const PUT = route<{ id: string }>(async ({ req, ctx, params }) =>
  updateTemplate(ctx, params.id, await readBody(req, templateInputSchema)),
);

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteTemplate(ctx, params.id);
  return { ok: true };
});
