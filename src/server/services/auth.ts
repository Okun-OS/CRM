import type { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { AppError, Conflict, Unauthenticated, ValidationError } from "@/lib/api/errors";
import { logInfo, logWarn } from "@/lib/logger";
import { registerSchema, loginSchema, changePasswordSchema, profileSchema } from "@/lib/schemas/auth";
import type { ActorContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { createOrganizationSlug, provisionOrganization } from "./organizations";

/**
 * Authentication.
 *
 * Passwords are scrypt-hashed, failed attempts are counted and the account is
 * temporarily locked after repeated failures. Login never reveals whether an
 * e-mail address exists.
 */

/**
 * Sperre nach Fehlversuchen: `LOGIN_MAX_FAILED_ATTEMPTS` falsche Passwörter
 * innerhalb von `LOGIN_FAILURE_WINDOW_MS` sperren das Konto für
 * `LOGIN_LOCK_DURATION_MS`. Ältere Fehlversuche verfallen, und nach Ablauf
 * einer Sperre beginnt die Zählung neu — sonst sperrte schon der erste
 * Tippfehler danach wieder für eine Viertelstunde.
 */
export const LOGIN_MAX_FAILED_ATTEMPTS = 10;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

/** „… bitte in 12 Minuten erneut versuchen.“ — mit der echten Restzeit statt „später“. */
export function loginLockedMessage(remainingMs: number): string {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Zu viele Fehlversuche: Die Anmeldung ist vorübergehend gesperrt. Bitte in ${minutes === 1 ? "einer Minute" : `${minutes} Minuten`} erneut versuchen.`;
}

/** Fehler „gesperrt“ — erkennbar, damit die Route ihn nicht als weiteren Fehlversuch zählt. */
export function loginLockedError(remainingMs: number) {
  return new AppError("UNAUTHENTICATED", loginLockedMessage(remainingMs), { reason: "locked" });
}

export type AuthenticatedUser = {
  userId: string;
  organizationId: string | null;
  email: string;
  name: string;
  /**
   * Wohin nach der Anmeldung. Ein Betreiber hat bewusst keine Mitgliedschaft
   * und gehört deshalb nicht aufs Dashboard eines Mandanten — ohne diese
   * Angabe landete er in einer Schleife zwischen Anmeldung und Dashboard.
   */
  redirectTo: string;
};

/** Registration creates the user, the organization and the owner membership. */
export async function register(input: z.input<typeof registerSchema>): Promise<AuthenticatedUser> {
  const data = registerSchema.parse(input);

  const existing = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (existing) {
    throw Conflict("Für diese E-Mail-Adresse existiert bereits ein Konto.");
  }

  const passwordHash = await hashPassword(data.password);
  const slug = await createOrganizationSlug(data.organizationName);

  const result = await prisma.$transaction(async (tx) => {
    const organization = await provisionOrganization(tx, { name: data.organizationName, slug });
    const user = await tx.user.create({
      data: { email: data.email, name: data.name, passwordHash },
    });
    await tx.membership.create({
      data: { organizationId: organization.id, userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE" },
    });
    return { user, organization };
  });

  await prisma.auditLog.create({
    data: {
      organizationId: result.organization.id,
      actorId: result.user.id,
      actorEmail: result.user.email,
      action: "organization.created",
      entityType: "Organization",
      entityId: result.organization.id,
      after: { name: result.organization.name },
    },
  });

  logInfo("auth.registered", { userId: result.user.id, organizationId: result.organization.id });
  return {
    userId: result.user.id,
    organizationId: result.organization.id,
    email: result.user.email,
    name: result.user.name,
    redirectTo: "/dashboard",
  };
}

export async function login(input: z.input<typeof loginSchema>): Promise<AuthenticatedUser> {
  const data = loginSchema.parse(input);
  const invalid = new AppError("UNAUTHENTICATED", "E-Mail-Adresse oder Passwort ist falsch.", { reason: "invalid_credentials" });

  const user = await prisma.user.findFirst({
    where: { email: data.email, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      failedLoginCount: true,
      lockedUntil: true,
      lastFailedLoginAt: true,
      isPlatformAdmin: true,
    },
  });

  if (!user) {
    // Equalise timing with the success path so the response does not leak existence.
    await verifyPassword(data.password, "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
    throw invalid;
  }

  const now = Date.now();
  if (user.lockedUntil && user.lockedUntil.getTime() > now) {
    throw loginLockedError(user.lockedUntil.getTime() - now);
  }

  const valid = await verifyPassword(data.password, user.passwordHash);
  if (!valid) {
    // Neu zählen, wenn eine Sperre abgelaufen ist oder der letzte Fehlversuch
    // außerhalb des Fensters liegt.
    const fresh =
      Boolean(user.lockedUntil) ||
      !user.lastFailedLoginAt ||
      now - user.lastFailedLoginAt.getTime() > LOGIN_FAILURE_WINDOW_MS;
    const failedLoginCount = fresh ? 1 : user.failedLoginCount + 1;
    const locked = failedLoginCount >= LOGIN_MAX_FAILED_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lastFailedLoginAt: new Date(now),
        lockedUntil: locked ? new Date(now + LOGIN_LOCK_DURATION_MS) : null,
      },
    });
    logWarn("auth.login_failed", { userId: user.id, failedLoginCount, locked });
    throw invalid;
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, status: "ACTIVE", organization: { deletedAt: null, suspendedAt: null } },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });

  // Ohne verwendbare Mitgliedschaft gibt es zwei Fälle, die sich für die
  // Person völlig unterschiedlich anfühlen: Betreiber haben bewusst keine —
  // sie arbeiten in keinem Mandanten. Ein Mitglied einer stillgelegten
  // Organisation soll dagegen erfahren, warum es nicht weitergeht, statt
  // nach erfolgreicher Anmeldung wortlos wieder auf der Anmeldeseite zu landen.
  if (!membership) {
    const suspended = await prisma.membership.findFirst({
      where: { userId: user.id, status: "ACTIVE", organization: { deletedAt: null, suspendedAt: { not: null } } },
      select: { id: true },
    });
    if (suspended) {
      throw Unauthenticated(
        "Der Zugang dieser Organisation ist derzeit stillgelegt. Bitte wenden Sie sich an OKUN Software.",
      );
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastFailedLoginAt: null, lastLoginAt: new Date() },
  });

  if (membership) {
    await prisma.auditLog.create({
      data: {
        organizationId: membership.organizationId,
        actorId: user.id,
        actorEmail: user.email,
        action: "auth.login",
        entityType: "User",
        entityId: user.id,
      },
    });
  }

  const platformAdmin = user.isPlatformAdmin;
  logInfo("auth.login", { userId: user.id });
  return {
    userId: user.id,
    organizationId: membership?.organizationId ?? null,
    email: user.email,
    name: user.name,
    // Ohne Mitgliedschaft gibt es kein Dashboard. Für Betreiber ist das der
    // Normalfall, nicht der Ausnahmefall.
    redirectTo: membership ? "/dashboard" : platformAdmin ? "/admin" : "/dashboard",
  };
}

export async function changePassword(ctx: ActorContext, input: z.input<typeof changePasswordSchema>) {
  const data = changePasswordSchema.parse(input);
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { passwordHash: true } });
  if (!user) throw Unauthenticated();

  const valid = await verifyPassword(data.currentPassword, user.passwordHash);
  if (!valid) throw ValidationError("Das aktuelle Passwort ist nicht korrekt.", { fields: { currentPassword: "Falsches Passwort" } });

  await prisma.user.update({ where: { id: ctx.userId }, data: { passwordHash: await hashPassword(data.newPassword) } });

  // All other sessions are invalidated after a password change.
  await prisma.session.updateMany({
    where: { userId: ctx.userId, revokedAt: null, ...(ctx.sessionId ? { id: { not: ctx.sessionId } } : {}) },
    data: { revokedAt: new Date() },
  });

  await writeAudit(ctx, { action: "auth.password_changed", entityType: "User", entityId: ctx.userId });
}

export async function updateProfile(ctx: ActorContext, input: z.input<typeof profileSchema>) {
  const data = profileSchema.parse(input);
  const user = await prisma.user.update({
    where: { id: ctx.userId },
    data: { name: data.name, timezone: data.timezone, locale: data.locale },
    select: { id: true, name: true, email: true, timezone: true, locale: true, avatarUrl: true },
  });
  await writeAudit(ctx, { action: "user.profile_updated", entityType: "User", entityId: ctx.userId, after: { name: data.name } });
  return user;
}

/** Sessions of the current user, for the security section of the profile. */
export async function listSessions(ctx: ActorContext) {
  const sessions = await prisma.session.findMany({
    where: { userId: ctx.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, ip: true, userAgent: true, lastSeenAt: true, createdAt: true, expiresAt: true },
  });
  return sessions.map((session) => ({
    id: session.id,
    ip: session.ip,
    userAgent: session.userAgent,
    lastSeenAt: session.lastSeenAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    isCurrent: session.id === ctx.sessionId,
  }));
}

export async function revokeSession(ctx: ActorContext, sessionId: string) {
  await prisma.session.updateMany({
    where: { id: sessionId, userId: ctx.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await writeAudit(ctx, { action: "auth.session_revoked", entityType: "Session", entityId: sessionId });
}
