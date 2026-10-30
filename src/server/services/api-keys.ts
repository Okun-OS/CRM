import { z } from "zod";
import { dateValue, requiredString } from "@/lib/schemas/crm";
import { prisma } from "@/lib/db";
import { assertPermission, buildContext, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { hashToken, randomToken } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { Unauthenticated, ValidationError } from "@/lib/api/errors";
import { API_KEY_SCOPES, type ApiKeyScope } from "@/lib/crm/api-keys";
import { MAILWIN_SCOPE } from "@/lib/crm/mailwin";

/**
 * API keys for machine-to-machine access — the way other OKUN products deliver
 * events into the CRM. A key is shown exactly once at creation; only its hash
 * is stored, and every key is bound to one organization, so the tenant of an
 * incoming event is never taken from the request body.
 */
export { API_KEY_SCOPES, API_KEY_SCOPE_LABELS, type ApiKeyScope } from "@/lib/crm/api-keys";

const PREFIX = "okun_ck";
/**
 * Mailwin-Schlüssel tragen ein eigenes Präfix: Man erkennt sie in Logs und
 * Secret-Scannern sofort, und sie lassen sich nie mit einem allgemeinen
 * Schlüssel verwechseln. Rechte gibt aber allein der Scope, nicht das Präfix.
 */
export const MAILWIN_KEY_PREFIX = "okun_mw";
const KNOWN_PREFIXES = [PREFIX, MAILWIN_KEY_PREFIX];

export const apiKeyInputSchema = z.object({
  name: requiredString("Name ist erforderlich.", 80),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, "Mindestens ein Scope ist erforderlich."),
  expiresAt: dateValue.nullable().optional(),
});

export async function listApiKeys(ctx: ActorContext) {
  assertPermission(ctx, "settings.manage");
  const keys = await prisma.apiKey.findMany({
    // Mailwin-Schlüssel werden unter Integrationen → Mailwin verwaltet.
    where: { ...scope(ctx), NOT: { scopes: { has: MAILWIN_SCOPE } } },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  return keys.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    createdBy: key.createdBy,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
  }));
}

/** Returns the plaintext key once — it cannot be recovered afterwards. */
export async function createApiKey(ctx: ActorContext, input: z.input<typeof apiKeyInputSchema>) {
  assertPermission(ctx, "settings.manage");
  const data = apiKeyInputSchema.parse(input);
  if (data.expiresAt && data.expiresAt.getTime() <= Date.now()) {
    throw ValidationError("Das Ablaufdatum muss in der Zukunft liegen.");
  }

  const { key, plaintext } = await issueApiKey(ctx, {
    name: data.name,
    scopes: data.scopes,
    expiresAt: data.expiresAt ?? null,
    prefix: PREFIX,
  });

  await writeAudit(ctx, {
    action: "api_key.created",
    entityType: "ApiKey",
    entityId: key.id,
    after: { name: key.name, scopes: key.scopes },
  });

  return { id: key.id, name: key.name, prefix: key.prefix, scopes: key.scopes, key: plaintext };
}

export async function revokeApiKey(ctx: ActorContext, id: string) {
  assertPermission(ctx, "settings.manage");
  const key = assertFound(
    await prisma.apiKey.findFirst({ where: { id, ...scope(ctx) } }),
    "Der API-Key wurde nicht gefunden.",
  );
  if (key.revokedAt) return { id: key.id, revokedAt: key.revokedAt.toISOString() };

  const updated = await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  await writeAudit(ctx, { action: "api_key.revoked", entityType: "ApiKey", entityId: key.id, before: { name: key.name } });
  return { id: updated.id, revokedAt: updated.revokedAt?.toISOString() ?? null };
}

/**
 * Erzeugt einen Schlüssel und gibt den Klartext genau einmal zurück. Gemeinsam
 * für allgemeine und Mailwin-Schlüssel; die Rechteprüfung liegt beim Aufrufer.
 */
export async function issueApiKey(
  ctx: ActorContext,
  input: { name: string; scopes: string[]; expiresAt?: Date | null; prefix: string },
) {
  const plaintext = `${input.prefix}_${randomToken(32)}`;
  const key = await prisma.apiKey.create({
    data: {
      organizationId: ctx.organizationId,
      name: input.name,
      prefix: plaintext.slice(0, 14),
      keyHash: hashToken(plaintext),
      scopes: input.scopes,
      createdById: ctx.userId,
      expiresAt: input.expiresAt ?? null,
    },
  });
  return { key, plaintext };
}

export type ApiKeyPrincipal = {
  keyId: string;
  keyName: string;
  organizationId: string;
  organizationName: string;
  /** Gesperrter oder gelöschter Arbeitsbereich: Der Schlüssel ist gültig, darf aber nichts. */
  organizationActive: boolean;
  scopes: string[];
  createdById: string | null;
};

/**
 * Authenticates a machine request. The key decides the tenant — a caller can
 * never reach another organization's data by changing a payload field.
 */
export async function authenticateApiKey(header: string | null): Promise<ApiKeyPrincipal> {
  const raw = header?.startsWith("Bearer ") ? header.slice(7).trim() : header?.trim();
  if (!raw || !KNOWN_PREFIXES.some((prefix) => raw.startsWith(`${prefix}_`))) {
    throw Unauthenticated("Kein gültiger API-Key übermittelt.");
  }

  const key = await prisma.apiKey.findUnique({
    where: { keyHash: hashToken(raw) },
    include: { organization: { select: { name: true, suspendedAt: true, deletedAt: true } } },
  });
  if (!key || key.revokedAt) throw Unauthenticated("Der API-Key ist ungültig oder wurde widerrufen.");
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) throw Unauthenticated("Der API-Key ist abgelaufen.");

  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });

  return {
    keyId: key.id,
    keyName: key.name,
    organizationId: key.organizationId,
    organizationName: key.organization.name,
    organizationActive: !key.organization.suspendedAt && !key.organization.deletedAt,
    scopes: key.scopes,
    createdById: key.createdById,
  };
}

export function assertScope(principal: ApiKeyPrincipal, required: ApiKeyScope): void {
  if (!principal.scopes.includes(required)) {
    throw Unauthenticated(`Dem API-Key fehlt der Scope „${required}“.`);
  }
}

/**
 * The actor a machine request acts as. Integration events are attributed to
 * the organization's administrator rather than to nobody, so the audit trail
 * stays complete.
 */
export async function contextForApiKey(
  principal: ApiKeyPrincipal,
  options: { preferCreator?: boolean } = {},
): Promise<ActorContext> {
  const admins = { organizationId: principal.organizationId, status: "ACTIVE" as const, role: { in: ["SUPER_ADMIN" as const, "ADMIN" as const] } };
  // Wer den Schlüssel erzeugt hat, steht als Verantwortliche(r) hinter seinen
  // Aufrufen — solange diese Person noch Administrator ist. Sonst die erste
  // Administratorin, damit ein ausgeschiedenes Konto die Integration nicht lahmlegt.
  const membership =
    (options.preferCreator && principal.createdById
      ? await prisma.membership.findFirst({
          where: { ...admins, userId: principal.createdById },
          include: { user: { select: { id: true, email: true, name: true } } },
        })
      : null) ??
    (await prisma.membership.findFirst({
      where: admins,
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, email: true, name: true } } },
    }));
  if (!membership) throw Unauthenticated("Die Organisation hat kein aktives Administratorkonto.");

  return buildContext({
    organizationId: principal.organizationId,
    organizationName: principal.organizationName,
    userId: membership.user.id,
    email: membership.user.email,
    name: membership.user.name,
    role: membership.role,
  });
}
