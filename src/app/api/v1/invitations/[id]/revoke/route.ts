import { route } from "@/lib/api/route";
import { revokeInvitation } from "@/server/services/users";

export const POST = route<{ id: string }>(async ({ ctx, params }) => {
  await revokeInvitation(ctx, params.id);
  return { ok: true };
});
