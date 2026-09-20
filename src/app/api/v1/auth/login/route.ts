import { route, readBody } from "@/lib/api/route";
import { assertUnderRateLimit, clearRateLimit, recordRateLimitFailure } from "@/lib/api/rate-limit";
import { loginSchema } from "@/lib/schemas/auth";
import { login } from "@/server/services/auth";
import { createSession, requestMeta } from "@/lib/auth/session";

export const POST = route(
  async ({ req }) => {
    const body = await readBody(req, loginSchema);

    /**
     * Failed attempts are counted per account, successful ones are not: a
     * person signing in from several devices is normal, ten wrong passwords in
     * a row is not. Keying on the account rather than on "anonymous" means one
     * attacker cannot lock the login endpoint for everybody else — and the
     * account itself is additionally locked in the auth service.
     */
    const rule = { key: `auth:login:${body.email}`, limit: 10, windowMs: 15 * 60 * 1000 };
    assertUnderRateLimit(rule);

    try {
      const user = await login(body);
      clearRateLimit(rule.key);
      await createSession(user.userId, user.organizationId, await requestMeta());
      return {
        userId: user.userId,
        email: user.email,
        name: user.name,
        organizationId: user.organizationId,
        redirectTo: user.redirectTo,
      };
    } catch (error) {
      recordRateLimitFailure(rule);
      throw error;
    }
  },
  // Instance-wide burst guard on top of the per-account limit above.
  { auth: false, rateLimit: { limit: 300, windowMs: 15 * 60 * 1000, scope: "auth:login:burst" } },
);
