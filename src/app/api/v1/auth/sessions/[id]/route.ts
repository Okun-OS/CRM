import { route } from "@/lib/api/route";
import { revokeSession } from "@/server/services/auth";

export const DELETE = route<{ id: string }>(async ({ ctx, params }) => {
  await revokeSession(ctx, params.id);
  return { ok: true };
});
