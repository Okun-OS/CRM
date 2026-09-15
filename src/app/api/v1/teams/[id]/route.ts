import { route } from "@/lib/api/route";
import { deleteTeam } from "@/server/services/users";

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await deleteTeam(ctx, params.id);
  return { ok: true };
});
