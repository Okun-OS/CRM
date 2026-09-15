import { route } from "@/lib/api/route";
import { deleteTag } from "@/server/services/settings";

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteTag(ctx, params.id);
  return { ok: true };
});
