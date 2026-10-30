import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { assertFound, scope } from "@/lib/tenant";
import { encryptSecret, randomToken } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { requiredString } from "@/lib/schemas/crm";
import {
  MAILWIN_API_BASE_PATH,
  MAILWIN_DEFAULT_WEBHOOK_URL,
  MAILWIN_SCOPE,
  MAILWIN_WEBHOOK_EVENTS,
  type MailwinWebhookType,
} from "@/lib/crm/mailwin";
import { issueApiKey, MAILWIN_KEY_PREFIX } from "@/server/services/api-keys";
import { appUrl } from "./service";
import { getSignalSettings } from "./signal-settings";

/**
 * Verwaltung der Mailwin-Verbindung: Schlüssel, Webhook an Mailwin und die
 * beiden Protokolle (Aufrufe von Mailwin, Zustellungen an Mailwin).
 *
 * Alles unter dem Recht `settings.manage` — wer einen Schlüssel erzeugt, gibt
 * einem anderen System Zugriff auf Kundendaten.
 */

/* ── Schlüssel ────────────────────────────────────────────────────────── */

export const mailwinKeyInputSchema = z.object({ name: requiredString("Name ist erforderlich.", 80) });

export async function listMailwinKeys(ctx: ActorContext) {
  assertPermission(ctx, "settings.manage");
  const keys = await prisma.apiKey.findMany({
    where: { ...scope(ctx), scopes: { has: MAILWIN_SCOPE } },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  return keys.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    createdBy: key.createdBy,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
  }));
}

/** Der Klartext erscheint genau einmal — gespeichert wird nur sein Hash. */
export async function createMailwinKey(ctx: ActorContext, input: z.input<typeof mailwinKeyInputSchema>) {
  assertPermission(ctx, "settings.manage");
  const data = mailwinKeyInputSchema.parse(input);
  const { key, plaintext } = await issueApiKey(ctx, { name: data.name, scopes: [MAILWIN_SCOPE], prefix: MAILWIN_KEY_PREFIX });

  await writeAudit(ctx, {
    action: "mailwin.key_created",
    entityType: "ApiKey",
    entityId: key.id,
    after: { name: key.name, scopes: key.scopes },
  });

  return { id: key.id, name: key.name, prefix: key.prefix, key: plaintext, baseUrl: `${appUrl()}${MAILWIN_API_BASE_PATH}` };
}

export async function revokeMailwinKey(ctx: ActorContext, id: string) {
  assertPermission(ctx, "settings.manage");
  const key = assertFound(
    await prisma.apiKey.findFirst({ where: { id, ...scope(ctx), scopes: { has: MAILWIN_SCOPE } } }),
    "Der Schlüssel wurde nicht gefunden.",
  );
  if (key.revokedAt) return { id: key.id, revokedAt: key.revokedAt.toISOString() };

  const updated = await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  await writeAudit(ctx, { action: "mailwin.key_revoked", entityType: "ApiKey", entityId: key.id, before: { name: key.name } });
  return { id: updated.id, revokedAt: updated.revokedAt?.toISOString() ?? null };
}

/* ── Webhook an Mailwin ───────────────────────────────────────────────── */

export const mailwinWebhookInputSchema = z.object({
  url: z
    .string()
    .trim()
    .url("Bitte eine gültige URL angeben.")
    .max(500)
    .refine((value) => /^https:\/\//i.test(value) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(value), {
      message: "Die Webhook-Adresse muss mit https:// beginnen.",
    }),
  /** Leer lassen, um das bestehende Geheimnis zu behalten. */
  secret: z.string().trim().min(16, "Das Geheimnis muss mindestens 16 Zeichen lang sein.").max(200).optional(),
  /** Ein neues Geheimnis erzeugen und einmal anzeigen. */
  generateSecret: z.boolean().optional(),
  events: z
    .array(z.enum(MAILWIN_WEBHOOK_EVENTS.map((event) => event.type) as [MailwinWebhookType, ...MailwinWebhookType[]]))
    .min(1, "Mindestens ein Ereignis auswählen."),
  isActive: z.boolean().default(true),
});

export type MailwinWebhookConfig = {
  id: string | null;
  url: string;
  events: MailwinWebhookType[];
  isActive: boolean;
  hasSecret: boolean;
  lastDeliveryAt: string | null;
};

async function findEndpoint(ctx: ActorContext) {
  return prisma.webhookEndpoint.findFirst({ where: { ...scope(ctx), format: "MAILWIN" }, orderBy: { createdAt: "asc" } });
}

export async function getMailwinWebhook(ctx: ActorContext): Promise<MailwinWebhookConfig> {
  assertPermission(ctx, "settings.manage");
  const endpoint = await findEndpoint(ctx);
  if (!endpoint) {
    return {
      id: null,
      url: MAILWIN_DEFAULT_WEBHOOK_URL,
      events: MAILWIN_WEBHOOK_EVENTS.map((event) => event.type),
      isActive: false,
      hasSecret: false,
      lastDeliveryAt: null,
    };
  }
  return {
    id: endpoint.id,
    url: endpoint.url,
    events: MAILWIN_WEBHOOK_EVENTS.filter((event) => endpoint.events.includes(event.source)).map((event) => event.type),
    isActive: endpoint.isActive,
    hasSecret: Boolean(endpoint.secret),
    lastDeliveryAt: endpoint.lastDeliveryAt?.toISOString() ?? null,
  };
}

/**
 * Speichert die Webhook-Verbindung. Das Geheimnis liegt AES-256-GCM
 * verschlüsselt in der Datenbank und wird nur zurückgegeben, wenn das CRM es
 * gerade selbst erzeugt hat — dann muss es einmal zu Mailwin übertragen werden.
 */
export async function saveMailwinWebhook(ctx: ActorContext, input: z.input<typeof mailwinWebhookInputSchema>) {
  assertPermission(ctx, "settings.manage");
  const data = mailwinWebhookInputSchema.parse(input);
  const existing = await findEndpoint(ctx);

  const generated = data.generateSecret || (!existing && !data.secret) ? randomToken(32) : null;
  const secret = generated ?? data.secret ?? null;
  const events = MAILWIN_WEBHOOK_EVENTS.filter((event) => data.events.includes(event.type)).map((event) => event.source);

  const endpoint = existing
    ? await prisma.webhookEndpoint.update({
        where: { id: existing.id },
        data: { url: data.url, events, isActive: data.isActive, ...(secret ? { secret: encryptSecret(secret) } : {}) },
      })
    : await prisma.webhookEndpoint.create({
        data: {
          organizationId: ctx.organizationId,
          url: data.url,
          events,
          isActive: data.isActive,
          format: "MAILWIN",
          description: "OKUN Mailwin",
          secret: encryptSecret(secret!),
          createdById: ctx.userId,
        },
      });

  await writeAudit(ctx, {
    action: existing ? "mailwin.webhook_updated" : "mailwin.webhook_created",
    entityType: "WebhookEndpoint",
    entityId: endpoint.id,
    before: existing ? { url: existing.url, events: existing.events, isActive: existing.isActive } : null,
    after: { url: endpoint.url, events: endpoint.events, isActive: endpoint.isActive, secretChanged: Boolean(secret) },
  });

  return { config: await getMailwinWebhook(ctx), secret: generated };
}

/* ── Protokolle ───────────────────────────────────────────────────────── */

export async function listMailwinRequests(ctx: ActorContext, limit = 50) {
  assertPermission(ctx, "settings.manage");
  const [rows, keys] = await Promise.all([
    prisma.integrationRequestLog.findMany({
      where: { ...scope(ctx), integration: "mailwin" },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    }),
    prisma.apiKey.findMany({ where: { ...scope(ctx), scopes: { has: MAILWIN_SCOPE } }, select: { id: true, name: true } }),
  ]);
  const names = new Map(keys.map((key) => [key.id, key.name]));
  return rows.map((row) => ({
    id: row.id,
    method: row.method,
    path: row.path,
    status: row.status,
    durationMs: row.durationMs,
    errorCode: row.errorCode,
    replayed: row.replayed,
    keyName: row.credentialId ? (names.get(row.credentialId) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listMailwinDeliveries(ctx: ActorContext, limit = 30) {
  assertPermission(ctx, "settings.manage");
  const endpoint = await findEndpoint(ctx);
  if (!endpoint) return [];
  const rows = await prisma.webhookDelivery.findMany({
    where: { ...scope(ctx), endpointId: endpoint.id },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });
  return rows.map((row) => {
    const payload = row.payload as { type?: string } | null;
    return {
      id: row.id,
      type: payload?.type ?? row.event,
      status: row.status,
      attempts: row.attempts,
      responseStatus: row.responseStatus,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
    };
  });
}

export async function getMailwinOverview(ctx: ActorContext) {
  const [keys, webhook, requests, deliveries, signals] = await Promise.all([
    listMailwinKeys(ctx),
    getMailwinWebhook(ctx),
    listMailwinRequests(ctx),
    listMailwinDeliveries(ctx),
    getSignalSettings(ctx),
  ]);
  return { baseUrl: `${appUrl()}${MAILWIN_API_BASE_PATH}`, keys, webhook, requests, deliveries, signals };
}
