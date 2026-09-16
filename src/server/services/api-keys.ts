import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, buildContext, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { hashToken, randomToken } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { Unauthenticated, ValidationError } from "@/lib/api/errors";

/**
 * API keys for machine-to-machine access — the way other OKUN products deliver
 * events into the CRM. A key is shown exactly once at creation; only its hash
 * is stored, and every key is bound to one organization, so the tenant of an
 * incoming event is never taken from the request body.
 */
export const API_KEY_SCOPES = ["events:write", "scheduler:run"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  "events:write": "Ereignisse melden (z. B. aus OKUN Deals)",
  "scheduler:run": "Geplante Automationen ausführen",
};

const PREFIX = "okun_ck";

export const apiKeyInputSchema = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich.").max(80),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, "Mindestens ein Scope ist erforderlich."),
  expiresAt: z.coerce.date().nullable().optional(),
});

export async function listApiKeys(ctx: ActorContext) {
  assertPermission(ctx, "settings.manage");
  const keys = await prisma.apiKey.findMany({
    where: scope(ctx),
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

  const secret = randomToken(32);
  const plaintext = `${PREFIX}_${secret}`;

  const key = await prisma.apiKey.create({
    data: {
      organizationId: ctx.organizationId,
      name: data.name,
      prefix: plaintext.slice(0, 14),
      keyHash: hashToken(plaintext),
      scopes: data.scopes,
      createdById: ctx.userId,
      expiresAt: data.expiresAt ?? null,
    },
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

export type ApiKeyPrincipal = {
  keyId: string;
  organizationId: string;
  organizationName: string;
  scopes: string[];
};

/**
 * Authenticates a machine request. The key decides the tenant — a caller can
 * never reach another organization's data by changing a payload field.
 */
export async function authenticateApiKey(header: string | null): Promise<ApiKeyPrincipal> {
  const raw = header?.startsWith("Bearer ") ? header.slice(7).trim() : header?.trim();
  if (!raw || !raw.startsWith(`${PREFIX}_`)) throw Unauthenticated("Kein gültiger API-Key übermittelt.");

  const key = await prisma.apiKey.findUnique({
    where: { keyHash: hashToken(raw) },
    include: { organization: { select: { name: true } } },
  });
  if (!key || key.revokedAt) throw Unauthenticated("Der API-Key ist ungültig oder wurde widerrufen.");
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) throw Unauthenticated("Der API-Key ist abgelaufen.");

  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });

  return {
    keyId: key.id,
    organizationId: key.organizationId,
    organizationName: key.organization.name,
    scopes: key.scopes,
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
export async function contextForApiKey(principal: ApiKeyPrincipal): Promise<ActorContext> {
  const membership = await prisma.membership.findFirst({
    where: { organizationId: principal.organizationId, status: "ACTIVE", role: { in: ["SUPER_ADMIN", "ADMIN"] } },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
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
