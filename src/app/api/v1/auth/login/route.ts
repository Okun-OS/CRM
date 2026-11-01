import { route, readBody } from "@/lib/api/route";
import { AppError, Unauthenticated } from "@/lib/api/errors";
import { assertUnderRateLimit, clearRateLimit, failuresLeft, recordRateLimitFailure } from "@/lib/api/rate-limit";
import { loginSchema } from "@/lib/schemas/auth";
import {
  login,
  LOGIN_FAILURE_WINDOW_MS,
  LOGIN_LOCK_DURATION_MS,
  LOGIN_MAX_FAILED_ATTEMPTS,
  loginLockedMessage,
} from "@/server/services/auth";
import { createSession, requestMeta } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/** Ab so vielen verbleibenden Versuchen warnt die Anmeldung vor der Sperre. */
const WARN_WHEN_LEFT = 3;

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
    const rule = { key: `auth:login:${body.email}`, limit: LOGIN_MAX_FAILED_ATTEMPTS, windowMs: LOGIN_FAILURE_WINDOW_MS };
    try {
      assertUnderRateLimit(rule, loginLockedMessage);
    } catch (blocked) {
      // Für ein bestehendes Konto entscheidet die Sperre in der Datenbank:
      // Sie gilt über Neustarts hinweg und lässt sich über die Konsole
      // aufheben (`pnpm admin:unlock`). Der Zähler hier im Speicher bremst nur
      // Versuche gegen Adressen ohne Konto und liefert die Hinweise.
      const known = await prisma.user.findFirst({ where: { email: body.email, deletedAt: null }, select: { id: true } });
      if (!known) throw blocked;
      clearRateLimit(rule.key);
    }

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
      // Gezählt wird nur ein falsches Passwort — nicht ein Versuch während der
      // Sperre und nicht die Meldung „Organisation stillgelegt“.
      const reason = error instanceof AppError ? (error.details as { reason?: string } | undefined)?.reason : undefined;
      if (reason === "invalid_credentials" && error instanceof AppError) {
        recordRateLimitFailure(rule);
        // Der Hinweis hängt nur an der Zahl der Versuche für diese Adresse,
        // nicht daran, ob es das Konto gibt — er verrät also nichts.
        const left = failuresLeft(rule);
        const lockMinutes = Math.round(LOGIN_LOCK_DURATION_MS / 60_000);
        if (left === 0) {
          throw Unauthenticated(`${error.message} Die Anmeldung ist jetzt für ${lockMinutes} Minuten gesperrt.`);
        }
        if (left <= WARN_WHEN_LEFT) {
          throw Unauthenticated(
            `${error.message} Noch ${left === 1 ? "ein Versuch" : `${left} Versuche`}, dann wird die Anmeldung für ${lockMinutes} Minuten gesperrt.`,
          );
        }
      }
      throw error;
    }
  },
  // Instance-wide burst guard on top of the per-account limit above.
  { auth: false, rateLimit: { limit: 300, windowMs: 15 * 60 * 1000, scope: "auth:login:burst" } },
);
