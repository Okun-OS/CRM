import type { CrmEventType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { EngineSubject, SubjectKind } from "./types";

/** Events that say who spoke last. */
const INBOUND_EVENTS: CrmEventType[] = ["EMAIL_RECEIVED", "CUSTOMER_REPLIED", "CONTRACT_ACCEPTED", "PAYMENT_RECEIVED"];
const OUTBOUND_EVENTS: CrmEventType[] = ["EMAIL_SENT", "CALL_LOGGED", "OFFER_SENT", "CONTRACT_SENT"];

/**
 * Loads the snapshot the rules work on. Everything the engine needs is read
 * here, once — the rules themselves never touch the database.
 */
export type SubjectRef = { kind: SubjectKind; id: string };

function leadLabel(lead: { firstName: string | null; lastName: string | null; companyName: string | null }): string {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.companyName || "Lead";
}

async function loadShared(organizationId: string, ref: SubjectRef) {
  const where = ref.kind === "DEAL" ? { dealId: ref.id } : { leadId: ref.id };

  const [manual, recall, openTask, lastEngagement] = await Promise.all([
    prisma.nextAction.findFirst({
      where: { organizationId, ...where, isManual: true, status: { in: ["OPEN", "SNOOZED"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.scheduledAutomation.findFirst({
      where: { organizationId, ...where, type: "RECALL", status: "PENDING" },
      orderBy: { scheduledFor: "asc" },
      select: { scheduledFor: true },
    }),
    prisma.task.findFirst({
      where: { organizationId, ...where, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] } },
      orderBy: { dueAt: "asc" },
      select: { dueAt: true },
    }),
    prisma.domainEventRecord.findFirst({
      where: { organizationId, ...where, type: { in: [...INBOUND_EVENTS, ...OUTBOUND_EVENTS] } },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      select: { type: true },
    }),
  ]);

  const openTaskCount = await prisma.task.count({
    where: { organizationId, ...where, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] } },
  });

  return {
    manualAction: manual
      ? {
          id: manual.id,
          type: manual.type,
          title: manual.title,
          reason: manual.reason,
          dueAt: manual.dueAt,
          priority: manual.priority,
          ownerId: manual.ownerId,
          snoozedUntil: manual.snoozedUntil,
        }
      : null,
    recallAt: recall?.scheduledFor ?? null,
    openTaskDueAt: openTask?.dueAt ?? null,
    openTaskCount,
    lastEngagementInbound: lastEngagement ? INBOUND_EVENTS.includes(lastEngagement.type) : null,
  };
}

export async function loadSubject(organizationId: string, ref: SubjectRef): Promise<EngineSubject | null> {
  if (ref.kind === "DEAL") {
    const deal = await prisma.deal.findFirst({
      where: { id: ref.id, organizationId, deletedAt: null },
      include: {
        stage: { select: { name: true, type: true, expectedAction: true, expectedActionDays: true } },
        contacts: { where: { isPrimary: true }, select: { contactId: true }, take: 1 },
      },
    });
    if (!deal) return null;

    const [shared, upcoming, held] = await Promise.all([
      loadShared(organizationId, ref),
      prisma.meeting.findFirst({
        where: { organizationId, dealId: deal.id, deletedAt: null, status: { not: "CANCELLED" }, startAt: { gt: new Date() } },
        orderBy: { startAt: "asc" },
        select: { startAt: true },
      }),
      prisma.meeting.findFirst({
        where: { organizationId, dealId: deal.id, deletedAt: null, status: { not: "CANCELLED" }, endAt: { lte: new Date() } },
        orderBy: { endAt: "desc" },
        select: { endAt: true },
      }),
    ]);

    return {
      kind: "DEAL",
      id: deal.id,
      organizationId,
      label: deal.name,
      ownerId: deal.ownerId,
      contactId: deal.contacts[0]?.contactId ?? null,
      companyId: deal.companyId,
      isOpen: deal.status === "OPEN" && deal.stage.type === "OPEN",
      createdAt: deal.createdAt,
      stageEnteredAt: deal.stageEnteredAt ?? deal.createdAt,
      lastActivityAt: deal.lastActivityAt,
      lastOutboundAt: deal.lastOutboundAt,
      lastCustomerResponseAt: deal.lastCustomerResponseAt,
      nextMeetingAt: upcoming?.startAt ?? deal.nextMeetingAt,
      meetingCompletedAt: held?.endAt ?? null,
      lastEngagementInbound: shared.lastEngagementInbound,
      offerSentAt: deal.offerSentAt,
      expectedCloseDate: deal.expectedCloseDate,
      recallAt: shared.recallAt,
      stageName: deal.stage.name,
      stageExpectedAction: deal.stage.expectedAction,
      stageExpectedActionDays: deal.stage.expectedActionDays,
      openTaskDueAt: shared.openTaskDueAt,
      openTaskCount: shared.openTaskCount,
      manualAction: shared.manualAction,
      automationPausedUntil: deal.automationPausedUntil,
    };
  }

  const lead = await prisma.lead.findFirst({ where: { id: ref.id, organizationId, deletedAt: null } });
  if (!lead) return null;
  const shared = await loadShared(organizationId, ref);

  return {
    kind: "LEAD",
    id: lead.id,
    organizationId,
    label: leadLabel(lead),
    ownerId: lead.ownerId,
    contactId: lead.contactId,
    companyId: lead.companyId,
    isOpen: lead.convertedAt === null,
    createdAt: lead.createdAt,
    stageEnteredAt: null,
    lastActivityAt: lead.lastActivityAt,
    lastOutboundAt: lead.lastOutboundAt,
    lastCustomerResponseAt: lead.lastCustomerResponseAt,
    nextMeetingAt: lead.nextMeetingAt,
    meetingCompletedAt: null,
    lastEngagementInbound: shared.lastEngagementInbound,
    offerSentAt: null,
    expectedCloseDate: null,
    recallAt: shared.recallAt,
    stageName: lead.status,
    stageExpectedAction: null,
    stageExpectedActionDays: null,
    openTaskDueAt: shared.openTaskDueAt,
    openTaskCount: shared.openTaskCount,
    manualAction: shared.manualAction,
    automationPausedUntil: lead.automationPausedUntil,
  };
}
