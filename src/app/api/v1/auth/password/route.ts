import { route, readBody } from "@/lib/api/route";
import { changePasswordSchema } from "@/lib/schemas/auth";
import { changePassword } from "@/server/services/auth";

export const POST = route(
  async ({ req, ctx }) => {
    await changePassword(ctx, await readBody(req, changePasswordSchema));
    return { ok: true };
  },
  { rateLimit: { limit: 5, windowMs: 60 * 60 * 1000, scope: "auth:password" } },
);
