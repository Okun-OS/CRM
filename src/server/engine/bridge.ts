import type { CrmEventType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { ActorContext } from "@/lib/context";
import type { DomainEvent } from "@/lib/events";
import { recordEvent } from "./events";

/**
 * Bridges the existing CRM domain events into the Active CRM event model.
 *
 * The services keep emitting what they always emitted (workflows and webhooks
 * listen to that); this translates the subset that changes a record's
 * operational reality into engine events, in one place instead of scattered
 * calls across the service layer.
 */
const EVENT_MAP: Record<string, CrmEventType> = {
  "contact.created": "CONTACT_CREATED",
  "lead.created": "LEAD_CREATED",
  "lead.status_changed": "LEAD_STATUS_CHANGED",
  "deal.created": "DEAL_CREATED",
  "deal.stage_changed": "DEAL_STAGE_CHANGED",
  "deal.won": "DEAL_WON",
  "deal.lost": "DEAL_LOST",
  "task.created": "TASK_CREATED",
  "task.completed": "TASK_COMPLETED",
  "meeting.created": "MEETING_BOOKED",
};

type Links = { contactId?: string | null; companyId?: string | null; dealId?: string | null; leadId?: string | null };

/** Resolves which record an event belongs to; tasks and meetings carry links. */
async function linksFor(ctx: ActorContext, event: DomainEvent): Promise<Links> {
  switch (event.entityType) {
    case "DEAL":
      return { dealId: event.entityId };
    case "LEAD":
      return { leadId: event.entityId };
    case "CONTACT":
      return { contactId: event.entityId };
    case "COMPANY":
      return { companyId: event.entityId };
    case "TASK": {
      const task = await prisma.task.findFirst({
        where: { id: event.entityId, organizationId: ctx.organizationId },
        select: { contactId: true, companyId: true, dealId: true, leadId: true },
      });
      return task ?? {};
    }
    case "MEETING": {
      const meeting = await prisma.meeting.findFirst({
        where: { id: event.entityId, organizationId: ctx.organizationId },
        select: { contactId: true, companyId: true, dealId: true },
      });
      return meeting ?? {};
    }
    default:
      return {};
  }
}

export async function bridgeToEngine(ctx: ActorContext, event: DomainEvent): Promise<void> {
  const type = EVENT_MAP[event.name];
  if (!type) return;

  const links = await linksFor(ctx, event);
  // Only records the engine reasons about are worth an event.
  if (!links.dealId && !links.leadId && type !== "CONTACT_CREATED") return;

  await recordEvent(ctx, {
    type,
    source: "USER",
    ...links,
    payload: event.payload,
  });
}
