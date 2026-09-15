import type { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { Conflict, Unauthenticated, ValidationError } from "@/lib/api/errors";
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
const MAX_FAILED_ATTEMPTS = 8;
const LOCK_DURATION_MS = 15 * 60 * 1000;

export type AuthenticatedUser = { userId: string; organizationId: string | null; email: string; name: string };

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
  };
}

export async function login(input: z.input<typeof loginSchema>): Promise<AuthenticatedUser> {
  const data = loginSchema.parse(input);
  const invalid = Unauthenticated("E-Mail-Adresse oder Passwort ist falsch.");

  const user = await prisma.user.findFirst({
    where: { email: data.email, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  });

  if (!user) {
    // Equalise timing with the success path so the response does not leak existence.
    await verifyPassword(data.password, "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
    throw invalid;
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw Unauthenticated("Das Konto ist vorübergehend gesperrt. Bitte später erneut versuchen.");
  }

  const valid = await verifyPassword(data.password, user.passwordHash);
  if (!valid) {
    const failedLoginCount = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lockedUntil: failedLoginCount >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_DURATION_MS) : null,
      },
    });
    logWarn("auth.login_failed", { userId: user.id, failedLoginCount });
    throw invalid;
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, status: "ACTIVE", organization: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
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

  logInfo("auth.login", { userId: user.id });
  return {
    userId: user.id,
    organizationId: membership?.organizationId ?? null,
    email: user.email,
    name: user.name,
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
