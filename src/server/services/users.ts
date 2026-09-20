import { z } from "zod";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { hashPassword, hashToken, randomToken } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { Conflict, Forbidden, NotFound, ValidationError } from "@/lib/api/errors";
import { assignableRoles, permissionsForRole } from "@/lib/rbac";
import { emailField } from "@/lib/schemas/crm";
import { acceptInvitationSchema } from "@/lib/schemas/auth";
import { env } from "@/lib/env";
import { logError } from "@/lib/logger";

/**
 * Members, roles, teams and invitations.
 *
 * Invitations are token-based: the token is hashed at rest and the invite link
 * is returned to the inviting administrator, because e-mail delivery depends on
 * an integration that may not be connected.
 */
const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export const inviteSchema = z.object({
  email: emailField,
  role: z.enum(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES", "USER"]),
  teamId: z.string().max(30).optional(),
});

export const memberUpdateSchema = z.object({
  role: z.enum(["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES", "USER"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  teamId: z.string().max(30).nullable().optional(),
});

export const teamSchema = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich.").max(80),
  parentTeamId: z.string().max(30).nullable().optional(),
});

export async function listMembers(ctx: ActorContext) {
  assertPermission(ctx, "users.read");
  const memberships = await prisma.membership.findMany({
    where: scope(ctx),
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true, lastLoginAt: true, twoFactorEnabledAt: true } },
      team: { select: { id: true, name: true } },
    },
    orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
  });

  return memberships.map((membership) => ({
    id: membership.id,
    userId: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    avatarUrl: membership.user.avatarUrl,
    role: membership.role,
    status: membership.status,
    team: membership.team,
    lastLoginAt: membership.user.lastLoginAt?.toISOString() ?? null,
    twoFactorEnabled: Boolean(membership.user.twoFactorEnabledAt),
    createdAt: membership.createdAt.toISOString(),
  }));
}

export async function listInvitations(ctx: ActorContext) {
  assertPermission(ctx, "users.manage");
  const invitations = await prisma.invitation.findMany({
    where: { ...scope(ctx), acceptedAt: null, revokedAt: null },
    include: { invitedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    invitedBy: invitation.invitedBy,
    expiresAt: invitation.expiresAt.toISOString(),
    expired: invitation.expiresAt.getTime() < Date.now(),
    createdAt: invitation.createdAt.toISOString(),
  }));
}

/** Creates an invitation and returns the one-time link to share. */
export async function inviteMember(ctx: ActorContext, input: z.input<typeof inviteSchema>) {
  assertPermission(ctx, "users.manage");
  const data = inviteSchema.parse(input);

  if (!assignableRoles(ctx.role).includes(data.role)) {
    throw Forbidden("Diese Rolle darfst du nicht vergeben.");
  }

  const existingMember = await prisma.membership.findFirst({
    where: { ...scope(ctx), user: { email: data.email } },
    select: { id: true },
  });
  if (existingMember) throw Conflict("Diese Person ist bereits Mitglied der Organisation.");

  await prisma.invitation.updateMany({
    where: { ...scope(ctx), email: data.email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const token = randomToken(24);
  const invitation = await prisma.invitation.create({
    data: {
      organizationId: ctx.organizationId,
      email: data.email,
      role: data.role,
      tokenHash: hashToken(token),
      invitedById: ctx.userId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
  });

  await writeAudit(ctx, {
    action: "user.invited",
    entityType: "Invitation",
    entityId: invitation.id,
    after: { email: data.email, role: data.role },
  });

  const inviteUrl = new URL(`/invite/${token}`, env().APP_URL).toString();

  // Ist ein Postausgang verbunden, geht die Einladung direkt raus. Sonst wird
  // der Link angezeigt — mit dem Grund, warum nichts verschickt wurde.
  const delivery = await deliverInvitation(ctx, {
    to: invitation.email,
    inviteUrl,
    expiresAt: invitation.expiresAt,
  });

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt.toISOString(),
    /** Einmalig angezeigt — für den Fall, dass kein Versand möglich war. */
    inviteUrl,
    emailSent: delivery.sent,
    emailSkippedReason: delivery.reason ?? null,
  };
}

export async function revokeInvitation(ctx: ActorContext, id: string) {
  assertPermission(ctx, "users.manage");
  const invitation = assertFound(
    await prisma.invitation.findFirst({ where: { id, ...scope(ctx), acceptedAt: null } }),
    "Die Einladung wurde nicht gefunden.",
  );
  await prisma.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
  await writeAudit(ctx, { action: "user.invitation_revoked", entityType: "Invitation", entityId: id, before: { email: invitation.email } });
}

/** Public: reads an invitation for the acceptance screen. */
export async function readInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organization: { select: { name: true } } },
  });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt.getTime() < Date.now()) {
    throw NotFound("Diese Einladung ist nicht mehr gültig.");
  }
  return {
    email: invitation.email,
    role: invitation.role,
    organizationName: invitation.organization.name,
  };
}

/** Public: accepts an invitation, creating the user account if needed. */
export async function acceptInvitation(input: z.input<typeof acceptInvitationSchema>) {
  const data = acceptInvitationSchema.parse(input);
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(data.token) } });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt.getTime() < Date.now()) {
    throw NotFound("Diese Einladung ist nicht mehr gültig.");
  }

  const passwordHash = await hashPassword(data.password);

  const result = await prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email: invitation.email } });
    if (!user) {
      user = await tx.user.create({ data: { email: invitation.email, name: data.name, passwordHash } });
    }

    const existing = await tx.membership.findFirst({
      where: { organizationId: invitation.organizationId, userId: user.id },
    });
    if (existing) {
      await tx.membership.update({ where: { id: existing.id }, data: { status: "ACTIVE", role: invitation.role } });
    } else {
      await tx.membership.create({
        data: {
          organizationId: invitation.organizationId,
          userId: user.id,
          role: invitation.role,
          status: "ACTIVE",
        },
      });
    }

    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    return user;
  });

  await prisma.auditLog.create({
    data: {
      organizationId: invitation.organizationId,
      actorId: result.id,
      actorEmail: result.email,
      action: "user.invitation_accepted",
      entityType: "Membership",
      after: { email: invitation.email, role: invitation.role },
    },
  });

  return { userId: result.id, organizationId: invitation.organizationId, email: result.email, name: result.name };
}

export async function updateMember(ctx: ActorContext, membershipId: string, input: z.input<typeof memberUpdateSchema>) {
  assertPermission(ctx, "users.manage");
  const data = memberUpdateSchema.parse(input);

  const membership = assertFound(
    await prisma.membership.findFirst({ where: { id: membershipId, ...scope(ctx) }, include: { user: true } }),
    "Das Mitglied wurde nicht gefunden.",
  );

  if (data.role && !assignableRoles(ctx.role).includes(data.role)) {
    throw Forbidden("Diese Rolle darfst du nicht vergeben.");
  }
  if (membership.userId === ctx.userId && (data.role || data.status)) {
    throw ValidationError("Die eigene Rolle oder der eigene Status kann nicht geändert werden.");
  }
  if (data.teamId) {
    const team = await prisma.team.findFirst({ where: { id: data.teamId, ...scope(ctx) }, select: { id: true } });
    if (!team) throw ValidationError("Das gewählte Team gehört nicht zu dieser Organisation.");
  }

  // The organization must keep at least one active owner.
  if ((data.role && membership.role === "SUPER_ADMIN") || (data.status === "SUSPENDED" && membership.role === "SUPER_ADMIN")) {
    const owners = await prisma.membership.count({ where: { ...scope(ctx), role: "SUPER_ADMIN", status: "ACTIVE" } });
    if (owners <= 1) throw ValidationError("Die Organisation benötigt mindestens einen aktiven Super-Administrator.");
  }

  const updated = await prisma.membership.update({
    where: { id: membership.id },
    data: { role: data.role, status: data.status, teamId: data.teamId === undefined ? undefined : data.teamId },
  });

  await writeAudit(ctx, {
    action: "user.membership_updated",
    entityType: "Membership",
    entityId: membership.id,
    before: { role: membership.role, status: membership.status, teamId: membership.teamId },
    after: { role: updated.role, status: updated.status, teamId: updated.teamId },
  });

  // A suspended member must not keep working with an existing session.
  if (data.status === "SUSPENDED") {
    await prisma.session.updateMany({ where: { userId: membership.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  return updated;
}

export async function removeMember(ctx: ActorContext, membershipId: string) {
  assertPermission(ctx, "users.manage");
  const membership = assertFound(
    await prisma.membership.findFirst({ where: { id: membershipId, ...scope(ctx) }, include: { user: true } }),
    "Das Mitglied wurde nicht gefunden.",
  );
  if (membership.userId === ctx.userId) throw ValidationError("Die eigene Mitgliedschaft kann nicht entfernt werden.");

  if (membership.role === "SUPER_ADMIN") {
    const owners = await prisma.membership.count({ where: { ...scope(ctx), role: "SUPER_ADMIN", status: "ACTIVE" } });
    if (owners <= 1) throw ValidationError("Die Organisation benötigt mindestens einen aktiven Super-Administrator.");
  }

  await prisma.membership.delete({ where: { id: membership.id } });
  await prisma.session.updateMany({ where: { userId: membership.userId, revokedAt: null }, data: { revokedAt: new Date() } });

  await writeAudit(ctx, {
    action: "user.removed",
    entityType: "Membership",
    entityId: membershipId,
    before: { email: membership.user.email, role: membership.role },
  });
}

export async function listTeams(ctx: ActorContext) {
  assertPermission(ctx, "users.read");
  const teams = await prisma.team.findMany({
    where: scope(ctx),
    include: { _count: { select: { memberships: true } }, parentTeam: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    parentTeam: team.parentTeam,
    memberCount: team._count.memberships,
  }));
}

export async function createTeam(ctx: ActorContext, input: z.input<typeof teamSchema>) {
  assertPermission(ctx, "users.manage");
  const data = teamSchema.parse(input);
  const existing = await prisma.team.findFirst({ where: { ...scope(ctx), name: data.name } });
  if (existing) throw Conflict("Ein Team mit diesem Namen existiert bereits.");

  if (data.parentTeamId) {
    const parent = await prisma.team.findFirst({ where: { id: data.parentTeamId, ...scope(ctx) } });
    if (!parent) throw ValidationError("Das übergeordnete Team wurde nicht gefunden.");
  }

  const team = await prisma.team.create({
    data: { organizationId: ctx.organizationId, name: data.name, parentTeamId: data.parentTeamId ?? null },
  });
  await writeAudit(ctx, { action: "team.created", entityType: "Team", entityId: team.id, after: { name: team.name } });
  return team;
}

export async function deleteTeam(ctx: ActorContext, id: string) {
  assertPermission(ctx, "users.manage");
  const team = assertFound(await prisma.team.findFirst({ where: { id, ...scope(ctx) } }), "Das Team wurde nicht gefunden.");
  await prisma.team.delete({ where: { id: team.id } });
  await writeAudit(ctx, { action: "team.deleted", entityType: "Team", entityId: id, before: { name: team.name } });
}

/** Role matrix for the settings screen — generated from the RBAC catalogue. */
export function roleMatrix() {
  const roles: Role[] = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES", "USER"];
  return roles.map((role) => ({ role, permissions: permissionsForRole(role) }));
}


/**
 * Zustellung einer Einladung über den Postausgang der Organisation.
 *
 * Scheitert der Versand, scheitert nicht die Einladung: Der Link existiert und
 * bleibt gültig, der Grund wird zurückgegeben und angezeigt.
 */
async function deliverInvitation(
  ctx: ActorContext,
  input: { to: string; inviteUrl: string; expiresAt: Date },
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const { resolveEmailTransport } = await import("@/server/integrations/email");
    const resolution = await resolveEmailTransport(ctx);
    if (!resolution.ok) return { sent: false, reason: resolution.reason };

    const until = input.expiresAt.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
    await resolution.transport.send({
      from: resolution.fromAddress,
      to: [input.to],
      subject: `Einladung zu OKUN CRM — ${ctx.organizationName}`,
      html: `<p>Guten Tag,</p><p>${escapeForEmail(ctx.name)} lädt Sie zu <strong>${escapeForEmail(ctx.organizationName)}</strong> in OKUN CRM ein.</p><p><a href="${input.inviteUrl}">Zugang einrichten</a></p><p style="color:#6B7280;font-size:12px;">Der Link gilt bis zum ${until} und kann nur einmal verwendet werden.</p><p style="color:#6B7280;font-size:11px;">Powered by OKUN Software</p>`,
      text: [
        "Guten Tag,",
        "",
        `${ctx.name} lädt Sie zu ${ctx.organizationName} in OKUN CRM ein.`,
        "",
        input.inviteUrl,
        "",
        `Der Link gilt bis zum ${until} und kann nur einmal verwendet werden.`,
      ].join("\n"),
    });
    return { sent: true };
  } catch (error) {
    logError("invitation.mail_failed", error, { to: input.to });
    return { sent: false, reason: "Der Versand ist fehlgeschlagen — bitte den Link von Hand weitergeben." };
  }
}

function escapeForEmail(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
