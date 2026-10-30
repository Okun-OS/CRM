import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, WebhookEndpoint } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ActorContext } from "@/lib/context";
import { assertPermission } from "@/lib/context";
import { scope } from "@/lib/tenant";
import type { DomainEvent } from "@/lib/events";
import { mailwinTypeFor } from "@/lib/crm/mailwin";
import { ValidationError } from "@/lib/api/errors";
import { attemptDelivery, scheduleDelivery } from "@/server/services/webhooks";
import { leadUrl, loadMailwinContact } from "./service";

/**
 * Webhooks an Mailwin (v1.1).
 *
 * Mailwin bekommt `{ id, type, occurredAt, data }` mit seinen eigenen
 * Ereignisnamen (`lead.*`, `contact.updated`), signiert wie jeder OKUN-Webhook:
 * `X-Okun-Signature: sha256=HMAC-SHA256(geheimnis, "<timestamp>.<rohbody>")`.
 *
 * Zugestellt wird asynchron: Die auslösende Anfrage wartet nie auf Mailwin.
 * Fehlschläge werden mit exponentiellem Abstand bis zu 24 Stunden wiederholt
 * (`src/server/services/webhooks.ts`, Format MAILWIN).
 *
 * Eine Änderung, die Mailwin selbst über die API ausgelöst hat, geht nicht als
 * Webhook an Mailwin zurück — sonst meldete das CRM Mailwin dessen eigene
 * Änderung als Neuigkeit.
 */
export type MailwinEnvelope = {
  id: string;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
};

export async function queueMailwinDelivery(ctx: ActorContext, endpoint: WebhookEndpoint, event: DomainEvent) {
  if (ctx.origin === "mailwin") return;
  const type = mailwinTypeFor(event.name);
  if (!type) return;

  const data = type === "contact.updated" ? await contactData(ctx, event) : await leadData(ctx, event);
  if (!data) return;

  await enqueue(ctx, endpoint, event.name, { id: `evt_${randomUUID()}`, type, occurredAt: new Date().toISOString(), data });
}

type TenantRef = Pick<ActorContext, "organizationId">;

async function enqueue(ctx: TenantRef, endpoint: WebhookEndpoint, event: string, envelope: MailwinEnvelope) {
  const delivery = await prisma.webhookDelivery.create({
    data: {
      organizationId: ctx.organizationId,
      endpointId: endpoint.id,
      event,
      payload: envelope as unknown as Prisma.InputJsonValue,
      status: "PENDING",
      nextRetryAt: new Date(),
    },
    select: { id: true },
  });
  scheduleDelivery(delivery.id);
  return delivery.id;
}

async function leadData(
  ctx: TenantRef,
  event: Pick<DomainEvent, "entityId" | "payload">,
): Promise<Record<string, unknown> | null> {
  const deal = await prisma.deal.findFirst({
    where: { id: event.entityId, organizationId: ctx.organizationId },
    include: {
      stage: { select: { id: true, name: true, type: true } },
      contacts: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: { isPrimary: true, contact: { select: { id: true, email: true, firstName: true, lastName: true } } },
      },
    },
  });
  if (!deal) return null;

  const payload = event.payload as { fromStageId?: string; fromStage?: string };
  return {
    lead: {
      id: deal.id,
      title: deal.name,
      url: leadUrl(deal.id),
      pipelineId: deal.pipelineId,
      stage: { id: deal.stage.id, name: deal.stage.name, type: deal.stage.type.toLowerCase() },
      status: deal.status.toLowerCase(),
      valueCents: Math.round(Number(deal.amount) * 100),
      currency: deal.currency,
      lostReason: deal.lostReason,
      contacts: deal.contacts.map(({ contact, isPrimary }) => ({
        id: contact.id,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        email: contact.email,
        isPrimary,
      })),
      sourceRef: deal.sourceRef ?? null,
    },
    previousStage: payload.fromStageId ? { id: payload.fromStageId, name: payload.fromStage ?? null } : null,
  };
}

async function contactData(ctx: ActorContext, event: DomainEvent): Promise<Record<string, unknown> | null> {
  try {
    const contact = await loadMailwinContact(ctx, event.entityId);
    return { contact, changed: event.changed?.filter((field) => !field.startsWith("property:")) ?? [] };
  } catch {
    return null;
  }
}

/**
 * Das aktive CRM hat für einen Lead eine neue nächste Aktion festgelegt —
 * etwa „Angebot nachfassen“, fällig am 10.11. Mailwin kann daraufhin zum
 * Fälligkeitstermin einen Entwurf im richtigen Thread vorbereiten.
 *
 * Aufgerufen aus `reconcileSubject`, also auch dann, wenn Mailwin die Änderung
 * selbst angestoßen hat: Die Fälligkeit ist eine Entscheidung des CRM, nicht
 * ein Echo von Mailwins Eingabe.
 */
export async function queueNextActionChanged(
  organizationId: string,
  dealId: string,
  nextAction: { type: string; title: string; reason: string; dueAt: Date | null; operationalState: string },
): Promise<void> {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { organizationId, format: "MAILWIN", isActive: true, events: { has: "deal.next_action_changed" } },
  });
  if (!endpoint) return;
  const ctx = { organizationId };
  const data = await leadData(ctx, { entityId: dealId, payload: {} });
  if (!data) return;
  await enqueue(ctx, endpoint, "deal.next_action_changed", {
    id: `evt_${randomUUID()}`,
    type: "lead.next_action_changed",
    occurredAt: new Date().toISOString(),
    data: {
      lead: data.lead,
      nextAction: {
        type: nextAction.type.toLowerCase(),
        title: nextAction.title,
        reason: nextAction.reason,
        dueAt: nextAction.dueAt?.toISOString() ?? null,
        operationalState: nextAction.operationalState.toLowerCase(),
      },
    },
  });
}

/**
 * „Verbindung testen“: ein `ping` an die hinterlegte Adresse, sofort und mit
 * Ergebnis. Mailwin kann daran Signaturprüfung und Erreichbarkeit testen.
 */
export async function sendMailwinTestWebhook(ctx: ActorContext) {
  assertPermission(ctx, "settings.manage");
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { ...scope(ctx), format: "MAILWIN" } });
  if (!endpoint) throw ValidationError("Zuerst die Webhook-Adresse und das Geheimnis speichern.");

  const delivery = await prisma.webhookDelivery.create({
    data: {
      organizationId: ctx.organizationId,
      endpointId: endpoint.id,
      event: "ping",
      payload: {
        id: `evt_${randomUUID()}`,
        type: "ping",
        occurredAt: new Date().toISOString(),
        data: { workspaceId: ctx.organizationId, message: "Testereignis aus OKUN CRM" },
      },
      status: "PENDING",
      // Ein Test wird nicht wiederholt — er soll jetzt antworten oder scheitern.
      nextRetryAt: null,
    },
    select: { id: true },
  });
  await attemptDelivery(delivery.id, { final: true });

  const result = await prisma.webhookDelivery.findUniqueOrThrow({
    where: { id: delivery.id },
    select: { status: true, responseStatus: true, error: true },
  });
  return { ok: result.status === "DELIVERED", responseStatus: result.responseStatus, error: result.error };
}
