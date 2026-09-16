import { z } from "zod";
import type { CrmEventType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { ActorContext } from "@/lib/context";
import { liveScope } from "@/lib/tenant";
import { ValidationError } from "@/lib/api/errors";
import { recordEvent } from "@/server/engine/events";

/**
 * Inbound event ingestion — how OKUN Deals and other products report what
 * happened without anybody re-typing it into the CRM.
 *
 * Two properties make this safe to expose: the tenant comes from the API key,
 * never from the payload, and every event carries an idempotency key, so a
 * retried delivery changes nothing.
 */
const INGESTIBLE_EVENTS = [
  "MEETING_BOOKED",
  "MEETING_COMPLETED",
  "MEETING_CANCELLED",
  "OFFER_CREATED",
  "OFFER_SENT",
  "OFFER_VIEWED",
  "CUSTOMER_REPLIED",
  "EMAIL_SENT",
  "EMAIL_RECEIVED",
  "CONTRACT_SENT",
  "CONTRACT_ACCEPTED",
  "PAYMENT_RECEIVED",
  "CALL_LOGGED",
] as const;

export const INGESTIBLE_EVENT_TYPES: readonly CrmEventType[] = INGESTIBLE_EVENTS;

export const ingestEventSchema = z.object({
  type: z.enum(INGESTIBLE_EVENTS),
  /** Stable per logical event; a repeated delivery is acknowledged, not applied twice. */
  idempotencyKey: z.string().trim().min(8).max(200),
  occurredAt: z.coerce.date().optional(),
  target: z
    .object({
      dealId: z.string().max(30).optional(),
      leadId: z.string().max(30).optional(),
      contactEmail: z.string().trim().email().max(180).optional(),
    })
    .refine(
      (value) => Boolean(value.dealId || value.leadId || value.contactEmail),
      "Es muss ein Deal, ein Lead oder eine Kontakt-E-Mail angegeben werden.",
    ),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const ingestBatchSchema = z.object({
  events: z.array(ingestEventSchema).min(1, "Mindestens ein Ereignis ist erforderlich.").max(50),
});

export type IngestResult = {
  idempotencyKey: string;
  status: "accepted" | "duplicate" | "unmatched";
  eventId: string | null;
  reason?: string;
};

type Target = { contactId: string | null; companyId: string | null; dealId: string | null; leadId: string | null };

/**
 * Finds the record an external event belongs to. Explicit ids win; otherwise
 * the contact's newest open deal, and failing that an open lead, is used.
 */
async function resolveTarget(ctx: ActorContext, target: z.infer<typeof ingestEventSchema>["target"]): Promise<Target | null> {
  if (target.dealId) {
    const deal = await prisma.deal.findFirst({
      where: { id: target.dealId, ...liveScope(ctx) },
      select: { id: true, companyId: true, contacts: { where: { isPrimary: true }, select: { contactId: true }, take: 1 } },
    });
    if (!deal) return null;
    return { dealId: deal.id, leadId: null, companyId: deal.companyId, contactId: deal.contacts[0]?.contactId ?? null };
  }

  if (target.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: target.leadId, ...liveScope(ctx) },
      select: { id: true, companyId: true, contactId: true },
    });
    if (!lead) return null;
    return { dealId: null, leadId: lead.id, companyId: lead.companyId, contactId: lead.contactId };
  }

  const email = target.contactEmail?.toLowerCase();
  if (!email) return null;

  const contact = await prisma.contact.findFirst({
    where: { ...liveScope(ctx), email },
    select: { id: true, companyId: true },
  });

  if (contact) {
    const deal = await prisma.deal.findFirst({
      where: { ...liveScope(ctx), status: "OPEN", contacts: { some: { contactId: contact.id } } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, companyId: true },
    });
    if (deal) {
      return { dealId: deal.id, leadId: null, companyId: deal.companyId ?? contact.companyId, contactId: contact.id };
    }
  }

  const lead = await prisma.lead.findFirst({
    where: { ...liveScope(ctx), email, convertedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, companyId: true, contactId: true },
  });
  if (lead) {
    return { dealId: null, leadId: lead.id, companyId: lead.companyId, contactId: lead.contactId ?? contact?.id ?? null };
  }

  return null;
}

export async function ingestEvents(
  ctx: ActorContext,
  input: z.input<typeof ingestBatchSchema>,
  source: "INTEGRATION" | "SYSTEM" = "INTEGRATION",
): Promise<IngestResult[]> {
  const data = ingestBatchSchema.parse(input);
  const keys = data.events.map((event) => event.idempotencyKey);
  if (new Set(keys).size !== keys.length) {
    throw ValidationError("Die Idempotenz-Schlüssel innerhalb eines Batches müssen eindeutig sein.");
  }

  const results: IngestResult[] = [];
  for (const event of data.events) {
    const target = await resolveTarget(ctx, event.target);
    if (!target) {
      results.push({
        idempotencyKey: event.idempotencyKey,
        status: "unmatched",
        eventId: null,
        reason: "Zu den übermittelten Angaben wurde kein offener Datensatz gefunden.",
      });
      continue;
    }

    const outcome = await recordEvent(ctx, {
      type: event.type,
      source,
      idempotencyKey: event.idempotencyKey,
      occurredAt: event.occurredAt,
      payload: event.payload,
      ...target,
    });

    results.push({
      idempotencyKey: event.idempotencyKey,
      status: outcome.duplicate ? "duplicate" : "accepted",
      eventId: outcome.id,
    });
  }

  return results;
}
