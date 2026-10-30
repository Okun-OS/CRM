import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, WebhookEndpoint } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ActorContext } from "@/lib/context";
import { assertPermission } from "@/lib/context";
import { scope } from "@/lib/tenant";
import type { DomainEvent } from "@/lib/events";
import { MAILWIN_DUE_ACTION_TYPES, mailwinTypeFor } from "@/lib/crm/mailwin";
import { logError } from "@/lib/logger";
import { ValidationError } from "@/lib/api/errors";
import { attemptDelivery, scheduleDelivery } from "@/server/services/webhooks";
import { leadUrl, loadMailwinContact } from "./service";

/**
 * Webhooks an Mailwin (v1.1).
 *
 * Mailwin bekommt `{ id, type, occurredAt, workspaceId, data }` mit seinen
 * eigenen Ereignisnamen (`lead.*`, `contact.*`, `signal.*`), signiert wie jeder
 * OKUN-Webhook (dazu Header `X-Okun-Workspace`, damit Mailwin das passende
 * Geheimnis findet, ohne alle durchzuprobieren):
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
  workspaceId: string;
  data: Record<string, unknown>;
};

export async function queueMailwinDelivery(ctx: ActorContext, endpoint: WebhookEndpoint, event: DomainEvent) {
  if (ctx.origin === "mailwin") return;
  const type = mailwinTypeFor(event.name);
  if (!type) return;

  let data: Record<string, unknown> | null;
  switch (type) {
    case "contact.updated":
      data = await contactData(ctx, event);
      break;
    case "contact.merged": {
      const payload = event.payload as { fromId?: string; intoId?: string };
      const contact = await loadMailwinContact(ctx, event.entityId).catch(() => null);
      data = { fromId: payload.fromId ?? null, intoId: payload.intoId ?? event.entityId, contact };
      break;
    }
    case "lead.deleted":
      data = { id: event.entityId };
      break;
    default:
      data = await leadData(ctx, event);
  }
  if (!data) return;

  await enqueue(ctx, endpoint, event.name, type, data);
}

type TenantRef = Pick<ActorContext, "organizationId">;

function envelope(ctx: TenantRef, type: string, data: Record<string, unknown>): MailwinEnvelope {
  return { id: `evt_${randomUUID()}`, type, occurredAt: new Date().toISOString(), workspaceId: ctx.organizationId, data };
}

async function enqueue(ctx: TenantRef, endpoint: WebhookEndpoint, event: string, type: string, data: Record<string, unknown>) {
  const body = envelope(ctx, type, data);
  const delivery = await prisma.webhookDelivery.create({
    data: {
      organizationId: ctx.organizationId,
      endpointId: endpoint.id,
      event,
      payload: body as unknown as Prisma.InputJsonValue,
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
  const endpoint = await endpointFor(organizationId, "deal.next_action_changed");
  if (!endpoint) return;
  const ctx = { organizationId };
  const data = await leadData(ctx, { entityId: dealId, payload: {} });
  if (!data) return;
  await enqueue(ctx, endpoint, "deal.next_action_changed", "lead.next_action_changed", {
    lead: data.lead,
    nextAction: {
      type: nextAction.type.toLowerCase(),
      title: nextAction.title,
      reason: nextAction.reason,
      dueAt: nextAction.dueAt?.toISOString() ?? null,
      operationalState: nextAction.operationalState.toLowerCase(),
    },
  });
}

async function endpointFor(organizationId: string, source: string) {
  return prisma.webhookEndpoint.findFirst({
    where: { organizationId, format: "MAILWIN", isActive: true, events: { has: source } },
  });
}

/**
 * Eine nächste Aktion ist jetzt fällig — etwa „Angebot nachfassen“. Mailwin
 * kann im zugeordneten Thread einen Nachfass-Entwurf zur Freigabe anlegen.
 * Ausgelöst vom Zustell-Worker (`announceDueNextActions`), genau einmal je Aktion.
 */
export async function queueNextActionDue(
  organizationId: string,
  dealId: string,
  action: { id: string; type: string; title: string; reason: string; dueAt: Date | null },
): Promise<boolean> {
  const endpoint = await endpointFor(organizationId, "deal.next_action_due");
  if (!endpoint) return false;
  const ctx = { organizationId };
  const data = await leadData(ctx, { entityId: dealId, payload: {} });
  if (!data) return false;
  await enqueue(ctx, endpoint, "deal.next_action_due", "lead.next_action_due", {
    lead: data.lead,
    nextAction: {
      id: action.id,
      type: action.type.toLowerCase(),
      title: action.title,
      reason: action.reason,
      dueAt: action.dueAt?.toISOString() ?? null,
    },
  });
  return true;
}

/** Ältere Fälligkeiten werden nicht mehr gemeldet, nur still als erledigt markiert. */
export const DUE_ANNOUNCE_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Meldet fällig gewordene nächste Aktionen an Mailwin, je Aktion genau einmal.
 *
 * Läuft im Zustell-Worker. `dueAnnouncedAt` dient als Reservierung: Wer die
 * Zeile zuerst von `null` auf einen Zeitpunkt setzt, meldet sie. Verschiebt
 * jemand die Aktion, wird das Feld zurückgesetzt und sie zum neuen Termin
 * erneut gemeldet. Was länger als `DUE_ANNOUNCE_WINDOW_MS` überfällig ist
 * (etwa beim ersten Einschalten), wird ohne Meldung markiert — sonst käme in
 * Mailwin eine Flut veralteter Entwürfe an.
 */
export async function announceDueNextActions(now = new Date(), limit = 100): Promise<{ announced: number; silenced: number }> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { format: "MAILWIN", isActive: true, events: { has: "deal.next_action_due" } },
    select: { organizationId: true },
  });
  const organizationIds = Array.from(new Set(endpoints.map((endpoint) => endpoint.organizationId)));
  if (organizationIds.length === 0) return { announced: 0, silenced: 0 };

  const cutoff = new Date(now.getTime() - DUE_ANNOUNCE_WINDOW_MS);
  const base = {
    organizationId: { in: organizationIds },
    dueAnnouncedAt: null,
    dealId: { not: null },
    type: { in: [...MAILWIN_DUE_ACTION_TYPES] },
  };

  const silenced = await prisma.nextAction.updateMany({
    where: {
      ...base,
      OR: [
        { status: "OPEN", dueAt: { lt: cutoff } },
        { status: "SNOOZED", snoozedUntil: { lt: cutoff } },
      ],
    },
    data: { dueAnnouncedAt: now },
  });

  const due = await prisma.nextAction.findMany({
    where: {
      ...base,
      deal: { status: "OPEN", deletedAt: null },
      OR: [
        { status: "OPEN", dueAt: { gte: cutoff, lte: now } },
        { status: "SNOOZED", snoozedUntil: { gte: cutoff, lte: now } },
      ],
    },
    orderBy: { dueAt: "asc" },
    take: limit,
    select: {
      id: true,
      organizationId: true,
      dealId: true,
      type: true,
      title: true,
      reason: true,
      status: true,
      dueAt: true,
      snoozedUntil: true,
    },
  });

  let announced = 0;
  for (const action of due) {
    const claimed = await prisma.nextAction.updateMany({
      where: { id: action.id, dueAnnouncedAt: null },
      data: { dueAnnouncedAt: now },
    });
    if (claimed.count === 0) continue;
    try {
      const sent = await queueNextActionDue(action.organizationId, action.dealId!, {
        ...action,
        dueAt: action.status === "SNOOZED" ? action.snoozedUntil : action.dueAt,
      });
      if (sent) announced++;
    } catch (error) {
      await prisma.nextAction.update({ where: { id: action.id }, data: { dueAnnouncedAt: null } }).catch(() => undefined);
      logError("mailwin.next_action_due_failed", error, { nextActionId: action.id });
    }
  }
  return { announced, silenced: silenced.count };
}

/**
 * Rückkanal für Lerneffekte: Ein Mensch hat einen Vorschlag aus Mailwin
 * übernommen oder verworfen. `proposalId` ist die `id` aus `proposed[]` der
 * Signal-Antwort (bzw. `proposed.id` bei Kontaktvorschlägen).
 */
export async function queueProposalResolved(
  ctx: TenantRef,
  suggestion: { id: string; kind: string; dealId: string | null; contactId: string | null; evidence: unknown },
  accepted: boolean,
): Promise<void> {
  const endpoint = await endpointFor(ctx.organizationId, "suggestion.resolved");
  if (!endpoint) return;
  const evidence = (suggestion.evidence ?? {}) as { signal?: string; externalId?: string; confidence?: number };
  await enqueue(ctx, endpoint, "suggestion.resolved", "signal.proposal_resolved", {
    proposalId: suggestion.id,
    kind: suggestion.kind,
    accepted,
    signal: evidence.signal ?? null,
    externalId: evidence.externalId ?? null,
    confidence: evidence.confidence ?? null,
    leadId: suggestion.dealId,
    contactId: suggestion.contactId,
    resolvedAt: new Date().toISOString(),
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
      payload: envelope(ctx, "ping", {
        workspaceId: ctx.organizationId,
        message: "Testereignis aus OKUN CRM",
      }) as unknown as Prisma.InputJsonValue,
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
