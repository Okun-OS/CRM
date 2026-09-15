import { route, readBody } from "@/lib/api/route";
import { loginSchema } from "@/lib/schemas/auth";
import { login } from "@/server/services/auth";
import { createSession, requestMeta } from "@/lib/auth/session";

export const POST = route(
  async ({ req }) => {
    const body = await readBody(req, loginSchema);
    const user = await login(body);
    await createSession(user.userId, user.organizationId, await requestMeta());
    return { userId: user.userId, email: user.email, name: user.name, organizationId: user.organizationId };
  },
  // Deliberately strict: this is the brute-force surface.
  { auth: false, rateLimit: { limit: 10, windowMs: 15 * 60 * 1000, scope: "auth:login" } },
);
