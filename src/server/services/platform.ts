import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { PlatformActor } from "@/lib/platform";
import { hashPassword, hashToken, randomToken } from "@/lib/crypto";
import { Conflict, NotFound, ValidationError } from "@/lib/api/errors";
import { emailField } from "@/lib/schemas/crm";
import { env } from "@/lib/env";
import { logInfo } from "@/lib/logger";
import { createOrganizationSlug, provisionOrganization } from "./organizations";

/**
 * Das Betreiber-Backoffice von OKUN Software.
 *
 * Die eine Regel, die dieses Modul zusammenhält: Es sieht **Kennzahlen und
 * Verwaltungsdaten** einer Kundenorganisation — wie viele Kontakte, wann
 * zuletzt gearbeitet wurde, wer Mitglied ist — und **niemals deren Inhalte**.
 * Es gibt hier bewusst keine Funktion, die einen Kontakt, einen Deal oder eine
 * Notiz eines Kunden zurückgibt. Wer Kundendaten sehen muss, braucht eine
 * Mitgliedschaft in dieser Organisation, und die ist sichtbar und protokolliert.
 */
const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export const customerInputSchema = z.object({
  organizationName: z.string().trim().min(2, "Bitte den Namen der Organisation angeben.").max(120),
  adminName: z.string().trim().min(2, "Bitte den Namen der Ansprechperson angeben.").max(80),
  adminEmail: emailField,
  currency: z.string().trim().length(3).default("EUR"),
  locale: z.string().trim().max(10).default("de-DE"),
  timezone: z.string().trim().max(60).default("Europe/Berlin"),
});

export const suspendSchema = z.object({
  reason: z.string().trim().min(1, "Bitte kurz begründen, warum die Organisation stillgelegt wird.").max(300),
});

async function writePlatformAudit(
  actor: PlatformActor,
  input: {
    action: string;
    organizationId?: string | null;
    organizationName?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await prisma.platformAuditLog.create({
    data: {
      actorId: actor.userId,
      actorEmail: actor.email,
      action: input.action,
      organizationId: input.organizationId ?? null,
      organizationName: input.organizationName ?? null,
      details: (input.details ?? {}) as Prisma.InputJsonValue,
      ip: actor.ip,
    },
  });
}

export type CustomerSummary = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  members: number;
  pendingInvitations: number;
  contacts: number;
  deals: number;
  openDeals: number;
  lastActivityAt: string | null;
  onboardingCompletedAt: string | null;
};

/**
 * Alle Kundenorganisationen mit ihren Kennzahlen. Die Zahlen werden gruppiert
 * ermittelt, nicht je Organisation einzeln — sonst wächst die Übersicht mit
 * jedem Kunden um weitere Abfragen.
 */
export async function listCustomers(actor: PlatformActor, search?: string): Promise<CustomerSummary[]> {
  void actor;
  const term = search?.trim();

  const organizations = await prisma.organization.findMany({
    where: {
      deletedAt: null,
      ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { slug: { contains: term, mode: "insensitive" } }] } : {}),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      suspendedAt: true,
      suspendedReason: true,
      onboardingCompletedAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const ids = organizations.map((organization) => organization.id);
  if (ids.length === 0) return [];

  const [members, invitations, contacts, deals, openDeals, lastActivity] = await Promise.all([
    prisma.membership.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids }, status: "ACTIVE" }, _count: true }),
    prisma.invitation.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: ids }, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      _count: true,
    }),
    prisma.contact.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids }, deletedAt: null }, _count: true }),
    prisma.deal.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids }, deletedAt: null }, _count: true }),
    prisma.deal.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: ids }, deletedAt: null, status: "OPEN" },
      _count: true,
    }),
    prisma.activity.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids } }, _max: { occurredAt: true } }),
  ]);

  const count = (rows: { organizationId: string; _count: number }[]) =>
    new Map(rows.map((row) => [row.organizationId, row._count]));

  const memberCount = count(members as never);
  const invitationCount = count(invitations as never);
  const contactCount = count(contacts as never);
  const dealCount = count(deals as never);
  const openDealCount = count(openDeals as never);
  const activityMax = new Map(lastActivity.map((row) => [row.organizationId, row._max.occurredAt]));

  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt: organization.createdAt.toISOString(),
    suspendedAt: organization.suspendedAt?.toISOString() ?? null,
    suspendedReason: organization.suspendedReason,
    onboardingCompletedAt: organization.onboardingCompletedAt?.toISOString() ?? null,
    members: memberCount.get(organization.id) ?? 0,
    pendingInvitations: invitationCount.get(organization.id) ?? 0,
    contacts: contactCount.get(organization.id) ?? 0,
    deals: dealCount.get(organization.id) ?? 0,
    openDeals: openDealCount.get(organization.id) ?? 0,
    lastActivityAt: activityMax.get(organization.id)?.toISOString() ?? null,
  }));
}

/** Eine Organisation im Detail — Verwaltungsdaten und Mitglieder, keine Inhalte. */
export async function getCustomer(actor: PlatformActor, organizationId: string) {
  void actor;
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      domain: true,
      industry: true,
      currency: true,
      locale: true,
      timezone: true,
      createdAt: true,
      suspendedAt: true,
      suspendedReason: true,
      onboardingCompletedAt: true,
      memberships: {

        select: {
          id: true,
          role: true,
          status: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, lastLoginAt: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      invitations: {
        where: { acceptedAt: null, revokedAt: null },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!organization) throw NotFound("Diese Organisation wurde nicht gefunden.");

  const [contacts, companies, deals, activities] = await Promise.all([
    prisma.contact.count({ where: { organizationId, deletedAt: null } }),
    prisma.company.count({ where: { organizationId, deletedAt: null } }),
    prisma.deal.count({ where: { organizationId, deletedAt: null } }),
    prisma.activity.count({ where: { organizationId } }),
  ]);

  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    domain: organization.domain,
    industry: organization.industry,
    currency: organization.currency,
    locale: organization.locale,
    timezone: organization.timezone,
    createdAt: organization.createdAt.toISOString(),
    suspendedAt: organization.suspendedAt?.toISOString() ?? null,
    suspendedReason: organization.suspendedReason,
    onboardingCompletedAt: organization.onboardingCompletedAt?.toISOString() ?? null,
    counts: { contacts, companies, deals, activities },
    members: organization.memberships.map((membership) => ({
      id: membership.id,
      role: membership.role,
      status: membership.status,
      joinedAt: membership.createdAt.toISOString(),
      user: {
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        lastLoginAt: membership.user.lastLoginAt?.toISOString() ?? null,
      },
    })),
    invitations: organization.invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    })),
  };
}

export type CreatedCustomer = {
  organizationId: string;
  organizationName: string;
  inviteUrl: string;
  invitationExpiresAt: string;
  emailSent: boolean;
  emailSkippedReason: string | null;
};

/**
 * Legt einen Kunden an: Organisation mit Standardkonfiguration plus eine
 * Einladung für die erste Ansprechperson als Super-Administrator.
 *
 * Bewusst wird **kein** Konto mit Passwort erzeugt: Der Kunde setzt sein
 * Passwort selbst über den Einladungslink. Der Betreiber kennt es nie.
 */
export async function createCustomer(
  actor: PlatformActor,
  input: z.input<typeof customerInputSchema>,
): Promise<CreatedCustomer> {
  const data = customerInputSchema.parse(input);

  const existingMember = await prisma.membership.findFirst({
    where: { user: { email: data.adminEmail }, status: "ACTIVE" },
    select: { organization: { select: { name: true } } },
  });
  if (existingMember) {
    throw Conflict(
      `Diese E-Mail-Adresse gehört bereits zu „${existingMember.organization.name}". Eine Person kann mehreren Organisationen angehören — dafür lade sie aus der betreffenden Organisation heraus ein.`,
    );
  }

  const slug = await createOrganizationSlug(data.organizationName);
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const organization = await prisma.$transaction(async (tx) => {
    const created = await provisionOrganization(tx, {
      name: data.organizationName,
      slug,
      currency: data.currency,
      locale: data.locale,
      timezone: data.timezone,
    });

    await tx.invitation.create({
      data: {
        organizationId: created.id,
        email: data.adminEmail,
        role: "SUPER_ADMIN",
        tokenHash: hashToken(token),
        invitedById: actor.userId,
        expiresAt,
      },
    });

    return created;
  });

  const inviteUrl = new URL(`/invite/${token}`, env().APP_URL).toString();

  await writePlatformAudit(actor, {
    action: "customer.created",
    organizationId: organization.id,
    organizationName: organization.name,
    details: { adminEmail: data.adminEmail, adminName: data.adminName },
  });
  logInfo("platform.customer_created", { organizationId: organization.id, actorId: actor.userId });

  const delivery = await sendInvitationEmail({
    to: data.adminEmail,
    recipientName: data.adminName,
    organizationName: organization.name,
    inviteUrl,
    expiresAt,
  });

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    inviteUrl,
    invitationExpiresAt: expiresAt.toISOString(),
    emailSent: delivery.sent,
    emailSkippedReason: delivery.reason ?? null,
  };
}

export async function suspendCustomer(
  actor: PlatformActor,
  organizationId: string,
  input: z.input<typeof suspendSchema>,
) {
  const data = suspendSchema.parse(input);
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { id: true, name: true, suspendedAt: true },
  });
  if (!organization) throw NotFound("Diese Organisation wurde nicht gefunden.");
  if (organization.suspendedAt) throw ValidationError("Diese Organisation ist bereits stillgelegt.");

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: organization.id },
      data: { suspendedAt: new Date(), suspendedReason: data.reason },
    }),
    // Laufende Sitzungen enden sofort, sonst wirkt die Stilllegung erst beim
    // nächsten Anmelden.
    prisma.session.updateMany({
      where: { activeOrganizationId: organization.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await writePlatformAudit(actor, {
    action: "customer.suspended",
    organizationId: organization.id,
    organizationName: organization.name,
    details: { reason: data.reason },
  });

  return getCustomer(actor, organization.id);
}

export async function reactivateCustomer(actor: PlatformActor, organizationId: string) {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { id: true, name: true, suspendedAt: true, suspendedReason: true },
  });
  if (!organization) throw NotFound("Diese Organisation wurde nicht gefunden.");
  if (!organization.suspendedAt) throw ValidationError("Diese Organisation ist nicht stillgelegt.");

  await prisma.organization.update({
    where: { id: organization.id },
    data: { suspendedAt: null, suspendedReason: null },
  });

  await writePlatformAudit(actor, {
    action: "customer.reactivated",
    organizationId: organization.id,
    organizationName: organization.name,
    details: { previousReason: organization.suspendedReason },
  });

  return getCustomer(actor, organization.id);
}

/** Erzeugt eine neue Einladung für eine bestehende Organisation. */
export async function inviteCustomerAdmin(
  actor: PlatformActor,
  organizationId: string,
  input: { email: string; name?: string },
): Promise<{ inviteUrl: string; expiresAt: string; emailSent: boolean; emailSkippedReason: string | null }> {
  const email = emailField.parse(input.email);
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!organization) throw NotFound("Diese Organisation wurde nicht gefunden.");

  const member = await prisma.membership.findFirst({
    where: { organizationId: organization.id, user: { email }, status: "ACTIVE" },
    select: { id: true },
  });
  if (member) throw Conflict("Diese Person ist bereits Mitglied dieser Organisation.");

  await prisma.invitation.updateMany({
    where: { organizationId: organization.id, email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  await prisma.invitation.create({
    data: {
      organizationId: organization.id,
      email,
      role: "SUPER_ADMIN",
      tokenHash: hashToken(token),
      invitedById: actor.userId,
      expiresAt,
    },
  });

  const inviteUrl = new URL(`/invite/${token}`, env().APP_URL).toString();
  await writePlatformAudit(actor, {
    action: "customer.admin_invited",
    organizationId: organization.id,
    organizationName: organization.name,
    details: { email },
  });

  const delivery = await sendInvitationEmail({
    to: email,
    recipientName: input.name?.trim() || email,
    organizationName: organization.name,
    inviteUrl,
    expiresAt,
  });

  return {
    inviteUrl,
    expiresAt: expiresAt.toISOString(),
    emailSent: delivery.sent,
    emailSkippedReason: delivery.reason ?? null,
  };
}

export async function listPlatformAudit(actor: PlatformActor, take = 100) {
  void actor;
  const entries = await prisma.platformAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(take, 300),
    select: {
      id: true,
      action: true,
      actorEmail: true,
      organizationId: true,
      organizationName: true,
      details: true,
      createdAt: true,
    },
  });
  return entries.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() }));
}

export async function platformOverview(actor: PlatformActor) {
  void actor;
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [total, suspended, createdThisMonth, activeUsers, pendingInvitations] = await Promise.all([
    prisma.organization.count({ where: { deletedAt: null } }),
    prisma.organization.count({ where: { deletedAt: null, suspendedAt: { not: null } } }),
    prisma.organization.count({ where: { deletedAt: null, createdAt: { gte: monthAgo } } }),
    prisma.user.count({ where: { deletedAt: null, lastLoginAt: { gte: monthAgo } } }),
    prisma.invitation.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } }),
  ]);

  return { total, suspended, active: total - suspended, createdThisMonth, activeUsers, pendingInvitations };
}

/** Unterstützt das Skript, mit dem der erste Betreiberzugang entsteht. */
export async function setPlatformAdmin(email: string, enabled: boolean) {
  const user = await prisma.user.update({
    where: { email: emailField.parse(email) },
    data: { isPlatformAdmin: enabled },
    select: { id: true, email: true, name: true, isPlatformAdmin: true },
  });
  return user;
}

export async function createPlatformUser(input: { email: string; name: string; password: string }) {
  const email = emailField.parse(input.email);
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw Conflict("Für diese E-Mail-Adresse existiert bereits ein Konto.");

  return prisma.user.create({
    data: {
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      isPlatformAdmin: true,
    },
    select: { id: true, email: true, name: true },
  });
}

/** Versand der Einladung — scheitert nie die Anlage, meldet aber den Grund. */
async function sendInvitationEmail(input: {
  to: string;
  recipientName: string;
  organizationName: string;
  inviteUrl: string;
  expiresAt: Date;
}): Promise<{ sent: boolean; reason?: string }> {
  const { sendPlatformEmail } = await import("@/server/integrations/platform-mail");
  return sendPlatformEmail({
    to: input.to,
    subject: `Ihr Zugang zu OKUN CRM — ${input.organizationName}`,
    html: invitationHtml(input),
    text: invitationText(input),
  });
}

function invitationHtml(input: {
  recipientName: string;
  organizationName: string;
  inviteUrl: string;
  expiresAt: Date;
}): string {
  const until = input.expiresAt.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
  return `<!doctype html>
<html lang="de"><body style="margin:0;background:#E5E7EB;padding:32px 16px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td style="background:#0D1117;padding:28px 32px;color:#ffffff;">
      <div style="font-size:18px;font-weight:600;letter-spacing:-0.01em;">OKUN <span style="color:#06B6D4;">CRM</span></div>
      <div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:2px;">Kunden. Beziehungen. Wachstum.</div>
    </td></tr>
    <tr><td style="padding:32px;color:#1A1F26;">
      <p style="margin:0 0 16px;font-size:15px;">Guten Tag ${escapeHtml(input.recipientName)},</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        für <strong>${escapeHtml(input.organizationName)}</strong> wurde ein Zugang zu OKUN CRM eingerichtet.
        Über den folgenden Link legen Sie Ihr Passwort fest und melden sich das erste Mal an.
      </p>
      <p style="margin:24px 0;">
        <a href="${input.inviteUrl}" style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:500;">Zugang einrichten</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#6B7280;line-height:1.6;">
        Der Link gilt bis zum ${until} und kann nur einmal verwendet werden.
        Falls der Knopf nicht funktioniert, kopieren Sie diese Adresse in Ihren Browser:
      </p>
      <p style="margin:0;font-size:12px;color:#6B7280;word-break:break-all;">${input.inviteUrl}</p>
    </td></tr>
    <tr><td style="padding:20px 32px;background:#F3F4F6;font-size:11px;color:#6B7280;letter-spacing:0.08em;text-transform:uppercase;">
      Powered by OKUN Software
    </td></tr>
  </table>
</body></html>`;
}

function invitationText(input: {
  recipientName: string;
  organizationName: string;
  inviteUrl: string;
  expiresAt: Date;
}): string {
  const until = input.expiresAt.toLocaleDateString("de-DE");
  return [
    `Guten Tag ${input.recipientName},`,
    "",
    `für ${input.organizationName} wurde ein Zugang zu OKUN CRM eingerichtet.`,
    "Über den folgenden Link legen Sie Ihr Passwort fest und melden sich das erste Mal an:",
    "",
    input.inviteUrl,
    "",
    `Der Link gilt bis zum ${until} und kann nur einmal verwendet werden.`,
    "",
    "Powered by OKUN Software",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
