import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { randomToken, signPayload } from "@/lib/crypto";
import { writeAudit } from "@/lib/audit";
import { logError, logWarn } from "@/lib/logger";
import { DOMAIN_EVENTS, type DomainEvent } from "@/lib/events";
import { paginate, paginationSchema, skipTake } from "@/lib/api/pagination";

/**
 * Outgoing webhooks.
 *
 * Deliveries are persisted first, then attempted; a failed attempt is retried
 * with exponential backoff by `retryPendingWebhookDeliveries`, which a
 * scheduled job (or the maintenance endpoint) calls. Every payload is signed
 * with HMAC-SHA256 over `timestamp.body`.
 */
export const MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000];
const REQUEST_TIMEOUT_MS = 10_000;

export const webhookInputSchema = z.object({
  url: z.string().url("Bitte eine gültige HTTPS-URL angeben.").max(500),
  events: z.array(z.enum(DOMAIN_EVENTS)).min(1, "Mindestens ein Event auswählen."),
  description: z.string().trim().max(200).optional(),
  isActive: z.boolean().default(true),
});

export async function listWebhookEndpoints(ctx: ActorContext) {
  assertPermission(ctx, "webhooks.manage");
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: scope(ctx),
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
    await prisma.webhookEndpoint.findFirst({ where: { id, ...scope(ctx) } }),
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
    await prisma.webhookEndpoint.findFirst({ where: { id, ...scope(ctx) } }),
    "Der Webhook wurde nicht gefunden.",
  );
  await prisma.webhookEndpoint.delete({ where: { id: existing.id } });
  await writeAudit(ctx, { action: "webhook.deleted", entityType: "WebhookEndpoint", entityId: id, before: { url: existing.url } });
}

export const deliveryQuerySchema = paginationSchema.extend({ endpointId: z.string().max(30).optional() });

export async function listWebhookDeliveries(ctx: ActorContext, query: z.infer<typeof deliveryQuerySchema>) {
  assertPermission(ctx, "webhooks.manage");
  const where = { ...scope(ctx), ...(query.endpointId ? { endpointId: query.endpointId } : {}) };
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

/** Sends one delivery; schedules a retry when the endpoint does not accept it. */
export async function attemptDelivery(deliveryId: string): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery || delivery.status === "DELIVERED") return;

  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signPayload(delivery.endpoint.secret, `${timestamp}.${body}`);
  const attempts = delivery.attempts + 1;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch(delivery.endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "OKUN-CRM-Webhooks/1.0",
        "x-okun-event": delivery.event,
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
        status: ok ? "DELIVERED" : attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
        responseStatus: response.status,
        responseBody,
        deliveredAt: ok ? new Date() : null,
        nextRetryAt: ok || attempts >= MAX_ATTEMPTS ? null : nextRetryAt(attempts),
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
        status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
        error: error instanceof Error ? error.message.slice(0, 500) : "Netzwerkfehler",
        nextRetryAt: attempts >= MAX_ATTEMPTS ? null : nextRetryAt(attempts),
      },
    });
  }
}

function nextRetryAt(attempts: number): Date {
  const backoff = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
  return new Date(Date.now() + backoff);
}

/** Retries all due deliveries. Call from a scheduled job. */
export async function retryPendingWebhookDeliveries(limit = 50): Promise<number> {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "PENDING", nextRetryAt: { lte: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { nextRetryAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const delivery of due) {
    await attemptDelivery(delivery.id);
  }
  return due.length;
}
