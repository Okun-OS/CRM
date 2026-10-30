import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { decryptSecret, randomToken, signPayload } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { logError, logWarn } from "@/lib/logger";
import { DOMAIN_EVENTS, type DomainEvent } from "@/lib/events";
import { paginate, paginationSchema, skipTake } from "@/lib/api/pagination";

/**
 * Outgoing webhooks.
 *
 * Deliveries are persisted first, then attempted; a failed attempt is retried
 * with exponential backoff by `processDueWebhookDeliveries`, which the
 * in-process worker (`webhook-worker.ts`) calls. Every payload is signed with
 * HMAC-SHA256 over `timestamp.body`.
 *
 * Two formats share this machinery:
 * - STANDARD: the general OKUN payload, attempted inline, up to five attempts.
 * - MAILWIN: the managed connection to OKUN Mailwin — Mailwin's envelope,
 *   encrypted secret, never attempted inside the triggering request, retried
 *   with exponential backoff for up to 24 hours.
 */
export const MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000];
const REQUEST_TIMEOUT_MS = 10_000;

/** Mailwin: 30 s, 1 min, 2 min, … höchstens 4 h Abstand, bis 24 h nach dem Ereignis. */
export const MAILWIN_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAILWIN_FIRST_BACKOFF_MS = 30_000;
const MAILWIN_MAX_BACKOFF_MS = 4 * 60 * 60 * 1000;
/** Eine gerade begonnene Zustellung ist so lange für andere Läufe reserviert. */
const CLAIM_LEASE_MS = 2 * 60_000;

export const webhookInputSchema = z.object({
  url: z.string().url("Bitte eine gültige HTTPS-URL angeben.").max(500),
  events: z.array(z.enum(DOMAIN_EVENTS)).min(1, "Mindestens ein Event auswählen."),
  description: z.string().trim().max(200).optional(),
  isActive: z.boolean().default(true),
});

export async function listWebhookEndpoints(ctx: ActorContext) {
  assertPermission(ctx, "webhooks.manage");
  const endpoints = await prisma.webhookEndpoint.findMany({
    // Die Mailwin-Verbindung wird unter Integrationen → Mailwin verwaltet.
    where: { ...scope(ctx), format: "STANDARD" },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { deliveries: true } } },
  });
  return endpoints.map((endpoint) => ({
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.events,
    description: endpoint.description,
    isActive: endpoint.isActive,
    // The secret is shown once on creation and never returned again.
    secretHint: `${endpoint.secret.slice(0, 6)}…`,
    lastDeliveryAt: endpoint.lastDeliveryAt?.toISOString() ?? null,
    deliveryCount: endpoint._count.deliveries,
    createdAt: endpoint.createdAt.toISOString(),
  }));
}

export async function createWebhookEndpoint(ctx: ActorContext, input: z.input<typeof webhookInputSchema>) {
  assertPermission(ctx, "webhooks.manage");
  const data = webhookInputSchema.parse(input);
  const secret = randomToken(24);

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      organizationId: ctx.organizationId,
      url: data.url,
      events: data.events,
      description: data.description,
      isActive: data.isActive,
      secret,
      createdById: ctx.userId,
    },
  });

  await writeAudit(ctx, {
    action: "webhook.created",
    entityType: "WebhookEndpoint",
    entityId: endpoint.id,
    after: { url: endpoint.url, events: endpoint.events },
  });

  // Returned exactly once so the receiving system can verify signatures.
  return { id: endpoint.id, url: endpoint.url, events: endpoint.events, secret };
}

export async function updateWebhookEndpoint(ctx: ActorContext, id: string, input: z.input<typeof webhookInputSchema>) {
  assertPermission(ctx, "webhooks.manage");
  const data = webhookInputSchema.parse(input);
  const existing = assertFound(
    await prisma.webhookEndpoint.findFirst({ where: { id, ...scope(ctx), format: "STANDARD" } }),
    "Der Webhook wurde nicht gefunden.",
  );

  await prisma.webhookEndpoint.update({
    where: { id: existing.id },
    data: { url: data.url, events: data.events, description: data.description, isActive: data.isActive },
  });

  await writeAudit(ctx, {
    action: "webhook.updated",
    entityType: "WebhookEndpoint",
    entityId: id,
    before: { url: existing.url, events: existing.events, isActive: existing.isActive },
    after: { url: data.url, events: data.events, isActive: data.isActive },
  });
}

export async function deleteWebhookEndpoint(ctx: ActorContext, id: string) {
  assertPermission(ctx, "webhooks.manage");
  const existing = assertFound(
    await prisma.webhookEndpoint.findFirst({ where: { id, ...scope(ctx), format: "STANDARD" } }),
    "Der Webhook wurde nicht gefunden.",
  );
  await prisma.webhookEndpoint.delete({ where: { id: existing.id } });
  await writeAudit(ctx, { action: "webhook.deleted", entityType: "WebhookEndpoint", entityId: id, before: { url: existing.url } });
}

export const deliveryQuerySchema = paginationSchema.extend({ endpointId: z.string().max(30).optional() });

export async function listWebhookDeliveries(ctx: ActorContext, query: z.infer<typeof deliveryQuerySchema>) {
  assertPermission(ctx, "webhooks.manage");
  const where = {
    ...scope(ctx),
    endpoint: { format: "STANDARD" as const },
    ...(query.endpointId ? { endpointId: query.endpointId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...skipTake(query),
      include: { endpoint: { select: { id: true, url: true } } },
    }),
    prisma.webhookDelivery.count({ where }),
  ]);

  return paginate(
    rows.map((row) => ({
      id: row.id,
      event: row.event,
      status: row.status,
      attempts: row.attempts,
      responseStatus: row.responseStatus,
      error: row.error,
      endpoint: row.endpoint,
      createdAt: row.createdAt.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
    })),
    total,
    query,
  );
}

/** Records a delivery and attempts it immediately. */
export async function queueWebhookDelivery(ctx: ActorContext, endpointId: string, event: DomainEvent): Promise<void> {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, ...scope(ctx), isActive: true },
  });
  if (!endpoint) return;

  if (endpoint.format === "MAILWIN") {
    const { queueMailwinDelivery } = await import("@/server/mailwin/webhooks");
    await queueMailwinDelivery(ctx, endpoint, event);
    return;
  }

  const delivery = await prisma.webhookDelivery.create({
    data: {
      organizationId: ctx.organizationId,
      endpointId: endpoint.id,
      event: event.name,
      payload: {
        event: event.name,
        organizationId: ctx.organizationId,
        entityType: event.entityType,
        entityId: event.entityId,
        data: event.payload,
        occurredAt: new Date().toISOString(),
      } as never,
    },
  });

  await attemptDelivery(delivery.id).catch((error) =>
    logError("webhook.attempt_failed", error, { deliveryId: delivery.id }),
  );
}

/**
 * Sends one delivery; schedules a retry when the endpoint does not accept it.
 * `final` marks a one-shot attempt (e.g. a connection test) that is never retried.
 */
export async function attemptDelivery(deliveryId: string, options: { final?: boolean } = {}): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery || delivery.status !== "PENDING") return;

  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const attempts = delivery.attempts + 1;

  let secret: string;
  try {
    secret = delivery.endpoint.format === "MAILWIN" ? decryptSecret(delivery.endpoint.secret) : delivery.endpoint.secret;
  } catch {
    // Ein Geheimnis, das sich nicht entschlüsseln lässt (ENCRYPTION_KEY
    // gewechselt), wird durch Wiederholen nicht besser.
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { attempts, status: "FAILED", nextRetryAt: null, error: "Webhook-Geheimnis nicht lesbar — bitte neu hinterlegen." },
    });
    return;
  }
  const signature = signPayload(secret, `${timestamp}.${body}`);
  const retryAt = options.final ? null : nextAttemptAt(delivery.endpoint.format, attempts, delivery.createdAt);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch(delivery.endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "OKUN-CRM-Webhooks/1.0",
        // Mailwin kennt die eigenen Ereignisnamen (lead.won), nicht die des CRM (deal.won).
        "x-okun-event":
          delivery.endpoint.format === "MAILWIN"
            ? String((delivery.payload as { type?: unknown } | null)?.type ?? delivery.event)
            : delivery.event,
        "x-okun-delivery": delivery.id,
        "x-okun-timestamp": timestamp,
        "x-okun-signature": `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const ok = response.status >= 200 && response.status < 300;
    const responseBody = (await response.text().catch(() => "")).slice(0, 1000);

    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts,
        status: ok ? "DELIVERED" : retryAt ? "PENDING" : "FAILED",
        responseStatus: response.status,
        responseBody,
        deliveredAt: ok ? new Date() : null,
        nextRetryAt: ok ? null : retryAt,
        error: ok ? null : `HTTP ${response.status}`,
      },
    });

    if (ok) {
      await prisma.webhookEndpoint.update({
        where: { id: delivery.endpointId },
        data: { lastDeliveryAt: new Date() },
      });
    } else {
      logWarn("webhook.delivery_rejected", { deliveryId: delivery.id, status: response.status, attempts });
    }
  } catch (error) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts,
        status: retryAt ? "PENDING" : "FAILED",
        error: error instanceof Error ? error.message.slice(0, 500) : "Netzwerkfehler",
        nextRetryAt: retryAt,
      },
    });
  }
}

/** When the next attempt is due after `attempts` failures — or null to give up. */
export function nextAttemptAt(
  format: "STANDARD" | "MAILWIN",
  attempts: number,
  createdAt: Date,
  now: Date = new Date(),
): Date | null {
  if (format === "MAILWIN") {
    const deadline = createdAt.getTime() + MAILWIN_RETRY_WINDOW_MS;
    if (now.getTime() >= deadline) return null;
    const backoff = Math.min(MAILWIN_FIRST_BACKOFF_MS * 2 ** (attempts - 1), MAILWIN_MAX_BACKOFF_MS);
    // Der letzte Versuch liegt genau am Ende des 24-Stunden-Fensters.
    return new Date(Math.min(now.getTime() + backoff, deadline));
  }
  if (attempts >= MAX_ATTEMPTS) return null;
  const backoff = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
  return new Date(now.getTime() + backoff);
}

/**
 * Reserves a due delivery for this process before sending it, so that two
 * runs (the worker and an immediate dispatch, or two instances) never send the
 * same event twice.
 */
async function claim(deliveryId: string, now: Date): Promise<boolean> {
  const result = await prisma.webhookDelivery.updateMany({
    where: { id: deliveryId, status: "PENDING", nextRetryAt: { lte: now } },
    data: { nextRetryAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
  });
  return result.count === 1;
}

/** Sends every delivery that is due. Called by the worker; safe to run concurrently. */
export async function processDueWebhookDeliveries(limit = 50): Promise<number> {
  const now = new Date();
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "PENDING", nextRetryAt: { lte: now } },
    orderBy: { nextRetryAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let sent = 0;
  for (const delivery of due) {
    if (!(await claim(delivery.id, now))) continue;
    await attemptDelivery(delivery.id).catch((error) =>
      logError("webhook.attempt_failed", error, { deliveryId: delivery.id }),
    );
    sent += 1;
  }
  return sent;
}

/** Retries all due deliveries. Kept for callers of the previous name. */
export const retryPendingWebhookDeliveries = processDueWebhookDeliveries;

/**
 * Starts a queued delivery right away — after the current request has
 * answered, never inside it. Tests switch this off and drive deliveries
 * explicitly through `processDueWebhookDeliveries`.
 */
let immediateDispatch = process.env.NODE_ENV !== "test";

export function setImmediateWebhookDispatch(enabled: boolean): void {
  immediateDispatch = enabled;
}

export function scheduleDelivery(deliveryId: string): void {
  if (!immediateDispatch) return;
  setTimeout(() => {
    void (async () => {
      if (await claim(deliveryId, new Date())) await attemptDelivery(deliveryId);
    })().catch((error) => logError("webhook.attempt_failed", error, { deliveryId }));
  }, 0);
}
