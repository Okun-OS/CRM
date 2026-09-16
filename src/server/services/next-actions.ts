import { z } from "zod";
import type { NextActionType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { assertPermission, can, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { ValidationError } from "@/lib/api/errors";
import { ACTION_BUCKETS, PRIORITY, type ActionBucketKey } from "@/lib/crm/active";
import { reconcileSubject } from "@/server/engine/next-actions";
import { scheduleAutomation, cancelAutomation, listAutomations } from "@/server/engine/automations";
import { recordEvent, listRecordEvents } from "@/server/engine/events";
import type { SubjectRef } from "@/server/engine/subject";
import { logSystemActivity } from "./activities";

/**
 * The user-facing side of the Next Action engine: the action center, and every
 * way a person can overrule what the system proposes. Overrides are never
 * silent — each one is written to the timeline and the audit log.
 */

export const nextActionSubjectSchema = z.object({
  kind: z.enum(["DEAL", "LEAD"]),
  id: z.string().min(1).max(30),
});

export const manualNextActionSchema = z.object({
  type: z.enum([
    "CONTACT_LEAD", "QUALIFY_LEAD", "FOLLOW_UP", "CALL", "SCHEDULE_MEETING", "CONFIRM_MEETING",
    "PREPARE_MEETING", "CREATE_OFFER", "SEND_OFFER", "CHASE_OFFER", "GET_DECISION",
    "PREPARE_CONTRACT", "REACTIVATE", "DEFINE_NEXT_STEP", "CUSTOM",
  ]),
  title: z.string().trim().min(1, "Titel ist erforderlich.").max(160),
  reason: z.string().trim().min(1, "Eine Begründung ist erforderlich.").max(500),
  dueAt: z.coerce.date().nullable().optional(),
  priority: z.coerce.number().int().min(0).max(100).default(PRIORITY.NORMAL),
  ownerId: z.string().max(30).nullable().optional(),
});

export const snoozeSchema = z.object({
  until: z.coerce.date(),
  reason: z.string().trim().max(300).optional(),
});

export const dismissSchema = z.object({
  reason: z.string().trim().min(1, "Bitte kurz begründen, warum die Empfehlung nicht passt.").max(300),
});

export const recallSchema = z.object({
  at: z.coerce.date(),
  reason: z.string().trim().min(1, "Eine Begründung ist erforderlich.").max(300),
});

export const pauseSchema = z.object({
  until: z.coerce.date(),
  reason: z.string().trim().min(1, "Eine Begründung ist erforderlich.").max(300),
});

function assertReadable(ctx: ActorContext, kind: "DEAL" | "LEAD") {
  assertPermission(ctx, kind === "DEAL" ? "deals.read" : "leads.read");
}

function assertWritable(ctx: ActorContext, kind: "DEAL" | "LEAD") {
  assertPermission(ctx, kind === "DEAL" ? "deals.write" : "leads.write");
}

function refOf(action: { dealId: string | null; leadId: string | null }): SubjectRef | null {
  if (action.dealId) return { kind: "DEAL", id: action.dealId };
  if (action.leadId) return { kind: "LEAD", id: action.leadId };
  return null;
}

function linksOf(ref: SubjectRef) {
  return ref.kind === "DEAL" ? { dealId: ref.id } : { leadId: ref.id };
}

async function assertSubjectExists(ctx: ActorContext, ref: SubjectRef): Promise<string> {
  if (ref.kind === "DEAL") {
    const deal = assertFound(
      await prisma.deal.findFirst({ where: { id: ref.id, ...scope(ctx), deletedAt: null }, select: { name: true } }),
      "Der Deal wurde nicht gefunden.",
    );
    return deal.name;
  }
  const lead = assertFound(
    await prisma.lead.findFirst({
      where: { id: ref.id, ...scope(ctx), deletedAt: null },
      select: { firstName: true, lastName: true, companyName: true },
    }),
    "Der Lead wurde nicht gefunden.",
  );
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.companyName || "Lead";
}

export type ActionItem = {
  id: string;
  type: NextActionType;
  title: string;
  reason: string;
  ruleKey: string | null;
  isManual: boolean;
  dueAt: string | null;
  priority: number;
  owner: { id: string; name: string } | null;
  record: { kind: "DEAL" | "LEAD"; id: string; label: string; amount: number | null; currency: string | null };
  operationalState: string;
  momentum: string;
  taskId: string | null;
};

const actionInclude = {
  owner: { select: { id: true, name: true } },
  deal: { select: { id: true, name: true, amount: true, currency: true, operationalState: true, momentum: true } },
  lead: {
    select: {
      id: true, firstName: true, lastName: true, companyName: true,
      operationalState: true, momentum: true,
    },
  },
} as const;

type ActionRow = {
  id: string;
  type: NextActionType;
  title: string;
  reason: string;
  ruleKey: string | null;
  isManual: boolean;
  dueAt: Date | null;
  priority: number;
  taskId: string | null;
  owner: { id: string; name: string } | null;
  deal: { id: string; name: string; amount: unknown; currency: string; operationalState: string; momentum: string } | null;
  lead: {
    id: string; firstName: string | null; lastName: string | null; companyName: string | null;
    operationalState: string; momentum: string;
  } | null;
};

function mapAction(row: ActionRow): ActionItem | null {
  const record = row.deal
    ? {
        kind: "DEAL" as const,
        id: row.deal.id,
        label: row.deal.name,
        amount: Number(row.deal.amount),
        currency: row.deal.currency,
      }
    : row.lead
      ? {
          kind: "LEAD" as const,
          id: row.lead.id,
          label:
            [row.lead.firstName, row.lead.lastName].filter(Boolean).join(" ") || row.lead.companyName || "Lead",
          amount: null,
          currency: null,
        }
      : null;
  if (!record) return null;

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    reason: row.reason,
    ruleKey: row.ruleKey,
    isManual: row.isManual,
    dueAt: row.dueAt?.toISOString() ?? null,
    priority: row.priority,
    owner: row.owner,
    record,
    operationalState: (row.deal ?? row.lead)?.operationalState ?? "NO_NEXT_ACTION",
    momentum: (row.deal ?? row.lead)?.momentum ?? "MEDIUM",
    taskId: row.taskId,
  };
}

export const actionCenterQuerySchema = z.object({
  ownerId: z.string().max(30).optional(),
  scope: z.enum(["mine", "team"]).default("mine"),
});

export type ActionCenterQuery = z.infer<typeof actionCenterQuerySchema>;

function bucketFor(item: ActionItem, now: Date): ActionBucketKey {
  const due = item.dueAt ? new Date(item.dueAt) : null;
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  if (item.operationalState === "NO_NEXT_ACTION" || item.type === "DEFINE_NEXT_STEP") return "without_next_action";
  if (due && due < startOfToday) return "overdue";
  if (due && due <= endOfToday) return "today";
  if (item.priority >= PRIORITY.HIGH) return "high_priority";
  if (item.type === "CONTACT_LEAD" || item.type === "QUALIFY_LEAD") return "new_leads";
  if (item.type === "FOLLOW_UP" || item.type === "CHASE_OFFER") return "follow_ups";
  if (item.operationalState === "WAITING_FOR_US") return "waiting_for_us";
  return "waiting_for_customer";
}

/**
 * The action center: every open next action the actor may see, sorted into the
 * buckets a sales day is actually worked through.
 */
export async function getActionCenter(ctx: ActorContext, query: ActionCenterQuery) {
  const readDeals = can(ctx, "deals.read");
  const readLeads = can(ctx, "leads.read");
  if (!readDeals && !readLeads) assertPermission(ctx, "deals.read");

  const now = new Date();
  const ownerFilter =
    query.scope === "mine" ? { ownerId: query.ownerId ?? ctx.userId } : query.ownerId ? { ownerId: query.ownerId } : {};

  const rows = await prisma.nextAction.findMany({
    where: {
      ...scope(ctx),
      ...ownerFilter,
      OR: [{ status: "OPEN" }, { status: "SNOOZED", snoozedUntil: { lte: now } }],
      ...(readDeals && readLeads
        ? {}
        : readDeals
          ? { dealId: { not: null } }
          : { leadId: { not: null } }),
    },
    include: actionInclude,
    orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
    take: 300,
  });

  const items = rows
    .map((row) => mapAction(row as unknown as ActionRow))
    .filter((item): item is ActionItem => item !== null);

  const buckets = ACTION_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    description: bucket.description,
    items: items.filter((item) => bucketFor(item, now) === bucket.key),
  }));

  return {
    generatedAt: now.toISOString(),
    total: items.length,
    buckets,
  };
}

/** Everything the record detail view shows about the engine's reasoning. */
export async function getRecordActionState(ctx: ActorContext, ref: SubjectRef) {
  assertReadable(ctx, ref.kind);
  await assertSubjectExists(ctx, ref);

  const [actions, automations, events] = await Promise.all([
    prisma.nextAction.findMany({
      where: { ...scope(ctx), ...linksOf(ref) },
      include: actionInclude,
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    listAutomations(ctx.organizationId, ref),
    listRecordEvents(ctx.organizationId, ref, 25),
  ]);

  const record =
    ref.kind === "DEAL"
      ? await prisma.deal.findFirst({
          where: { id: ref.id, ...scope(ctx) },
          select: {
            operationalState: true, momentum: true, momentumSignals: true, nextActionAt: true,
            nextActionTitle: true, nextActionType: true, stalledSince: true,
            automationPausedUntil: true, automationPausedReason: true,
            lastOutboundAt: true, lastCustomerResponseAt: true, nextMeetingAt: true, offerSentAt: true,
          },
        })
      : await prisma.lead.findFirst({
          where: { id: ref.id, ...scope(ctx) },
          select: {
            operationalState: true, momentum: true, momentumSignals: true, nextActionAt: true,
            nextActionTitle: true, nextActionType: true, stalledSince: true,
            automationPausedUntil: true, automationPausedReason: true,
            lastOutboundAt: true, lastCustomerResponseAt: true, nextMeetingAt: true,
          },
        });

  const open = actions.find((action) => action.status === "OPEN" || action.status === "SNOOZED");

  return {
    state: record,
    current: open ? mapAction(open as unknown as ActionRow) : null,
    history: actions
      .filter((action) => action.status !== "OPEN")
      .map((action) => ({
        id: action.id,
        title: action.title,
        reason: action.reason,
        status: action.status,
        ruleKey: action.ruleKey,
        isManual: action.isManual,
        completedAt: action.completedAt?.toISOString() ?? null,
        dismissedAt: action.dismissedAt?.toISOString() ?? null,
        dismissReason: action.dismissReason,
        createdAt: action.createdAt.toISOString(),
      })),
    automations: automations.map((automation) => ({
      id: automation.id,
      type: automation.type,
      status: automation.status,
      scheduledFor: automation.scheduledFor.toISOString(),
      reason: automation.reason,
      outcomeReason: automation.outcomeReason,
      executedAt: automation.executedAt?.toISOString() ?? null,
    })),
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      source: event.source,
      occurredAt: event.occurredAt.toISOString(),
      actor: event.actor,
      payload: event.payload,
    })),
  };
}

export async function completeNextAction(ctx: ActorContext, id: string, note?: string) {
  const action = assertFound(
    await prisma.nextAction.findFirst({ where: { id, ...scope(ctx) } }),
    "Die nächste Aktion wurde nicht gefunden.",
  );
  const ref = refOf(action);
  if (!ref) throw ValidationError("Die Aktion ist mit keinem Datensatz verknüpft.");
  assertWritable(ctx, ref.kind);
  if (action.status === "DONE") return getRecordActionState(ctx, ref);

  await prisma.$transaction(async (tx) => {
    await tx.nextAction.update({
      where: { id: action.id },
      data: { status: "DONE", completedAt: new Date(), completedById: ctx.userId },
    });
    if (action.taskId) {
      await tx.task.updateMany({
        where: { id: action.taskId, organizationId: ctx.organizationId, status: { in: ["OPEN", "IN_PROGRESS"] } },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
  });

  await logSystemActivity(ctx, {
    subject: `Nächste Aktion erledigt: ${action.title}`,
    body: note,
    links: linksOf(ref),
    metadata: { nextActionId: action.id, ruleKey: action.ruleKey },
  });
  await writeAudit(ctx, {
    action: "next_action.completed",
    entityType: "NextAction",
    entityId: action.id,
    after: { title: action.title },
  });
  await recordEvent(ctx, {
    type: "NEXT_ACTION_COMPLETED",
    source: "USER",
    ...linksOf(ref),
    payload: { nextActionId: action.id, title: action.title, note: note ?? null },
  });

  await reconcileSubject(ctx.organizationId, ref, { actorId: ctx.userId });
  return getRecordActionState(ctx, ref);
}

export async function snoozeNextAction(ctx: ActorContext, id: string, input: z.input<typeof snoozeSchema>) {
  const data = snoozeSchema.parse(input);
  const action = assertFound(
    await prisma.nextAction.findFirst({ where: { id, ...scope(ctx) } }),
    "Die nächste Aktion wurde nicht gefunden.",
  );
  const ref = refOf(action);
  if (!ref) throw ValidationError("Die Aktion ist mit keinem Datensatz verknüpft.");
  assertWritable(ctx, ref.kind);
  if (data.until.getTime() <= Date.now()) throw ValidationError("Der Zeitpunkt muss in der Zukunft liegen.");

  // Postponing makes the action the user's own decision from here on, so the
  // engine stops replacing it with its own proposal.
  await prisma.nextAction.update({
    where: { id: action.id },
    data: { status: "SNOOZED", snoozedUntil: data.until, isManual: true },
  });

  await logSystemActivity(ctx, {
    subject: `Nächste Aktion verschoben: ${action.title}`,
    body: data.reason,
    links: linksOf(ref),
    metadata: { nextActionId: action.id, until: data.until.toISOString() },
  });
  await writeAudit(ctx, {
    action: "next_action.snoozed",
    entityType: "NextAction",
    entityId: action.id,
    after: { until: data.until.toISOString(), reason: data.reason ?? null },
  });
  await recordEvent(ctx, {
    type: "NEXT_ACTION_SNOOZED",
    source: "USER",
    ...linksOf(ref),
    payload: { nextActionId: action.id, until: data.until.toISOString(), reason: data.reason ?? null },
  });

  await reconcileSubject(ctx.organizationId, ref, { actorId: ctx.userId });
  return getRecordActionState(ctx, ref);
}

export async function dismissNextAction(ctx: ActorContext, id: string, input: z.input<typeof dismissSchema>) {
  const data = dismissSchema.parse(input);
  const action = assertFound(
    await prisma.nextAction.findFirst({ where: { id, ...scope(ctx) } }),
    "Die nächste Aktion wurde nicht gefunden.",
  );
  const ref = refOf(action);
  if (!ref) throw ValidationError("Die Aktion ist mit keinem Datensatz verknüpft.");
  assertWritable(ctx, ref.kind);

  await prisma.nextAction.update({
    where: { id: action.id },
    data: { status: "DISMISSED", dismissedAt: new Date(), dismissReason: data.reason },
  });

  await logSystemActivity(ctx, {
    subject: `Empfehlung verworfen: ${action.title}`,
    body: data.reason,
    links: linksOf(ref),
    metadata: { nextActionId: action.id, ruleKey: action.ruleKey },
  });
  await writeAudit(ctx, {
    action: "next_action.dismissed",
    entityType: "NextAction",
    entityId: action.id,
    after: { reason: data.reason },
  });

  await reconcileSubject(ctx.organizationId, ref, { actorId: ctx.userId });
  return getRecordActionState(ctx, ref);
}

/** A next action the user defines themselves; it wins over every rule. */
export async function setManualNextAction(
  ctx: ActorContext,
  ref: SubjectRef,
  input: z.input<typeof manualNextActionSchema>,
) {
  assertWritable(ctx, ref.kind);
  const data = manualNextActionSchema.parse(input);
  const label = await assertSubjectExists(ctx, ref);

  if (data.ownerId) {
    const member = await prisma.membership.findFirst({
      where: { organizationId: ctx.organizationId, userId: data.ownerId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!member) throw ValidationError("Der gewählte Verantwortliche gehört nicht zu dieser Organisation.");
  }

  const contactId =
    ref.kind === "DEAL"
      ? (
          await prisma.dealContact.findFirst({
            where: { dealId: ref.id, organizationId: ctx.organizationId },
            orderBy: { isPrimary: "desc" },
            select: { contactId: true },
          })
        )?.contactId ?? null
      : null;

  const action = await prisma.$transaction(async (tx) => {
    await tx.nextAction.updateMany({
      where: { ...scope(ctx), ...linksOf(ref), status: { in: ["OPEN", "SNOOZED"] } },
      data: { status: "SUPERSEDED" },
    });
    return tx.nextAction.create({
      data: {
        organizationId: ctx.organizationId,
        type: data.type,
        title: data.title,
        reason: data.reason,
        isManual: true,
        dueAt: data.dueAt ?? null,
        priority: data.priority,
        ownerId: data.ownerId ?? ctx.userId,
        contactId,
        ...linksOf(ref),
      },
    });
  });

  await logSystemActivity(ctx, {
    subject: `Nächste Aktion festgelegt: ${data.title}`,
    body: data.reason,
    links: linksOf(ref),
    metadata: { nextActionId: action.id, manual: true, record: label },
  });
  await writeAudit(ctx, {
    action: "next_action.set_manually",
    entityType: "NextAction",
    entityId: action.id,
    after: { title: data.title, dueAt: data.dueAt?.toISOString() ?? null },
  });

  await reconcileSubject(ctx.organizationId, ref, { actorId: ctx.userId });
  return getRecordActionState(ctx, ref);
}

/** "Melden Sie sich im November" — a recall date, kept by the engine. */
export async function setRecall(ctx: ActorContext, ref: SubjectRef, input: z.input<typeof recallSchema>) {
  assertWritable(ctx, ref.kind);
  const data = recallSchema.parse(input);
  if (data.at.getTime() <= Date.now()) throw ValidationError("Die Wiedervorlage muss in der Zukunft liegen.");
  await assertSubjectExists(ctx, ref);

  const owner =
    ref.kind === "DEAL"
      ? (await prisma.deal.findFirst({ where: { id: ref.id, ...scope(ctx) }, select: { ownerId: true } }))?.ownerId
      : (await prisma.lead.findFirst({ where: { id: ref.id, ...scope(ctx) }, select: { ownerId: true } }))?.ownerId;

  const automation = await scheduleAutomation(ctx.organizationId, ref, {
    type: "RECALL",
    scheduledFor: data.at,
    reason: data.reason,
    ruleKey: "manual.recall",
    dedupeKey: "manual.recall",
    guards: [{ kind: "record_open" }, { kind: "automation_not_paused" }],
    ownerId: owner ?? ctx.userId,
    createdById: ctx.userId,
  });

  await writeAudit(ctx, {
    action: "recall.set",
    entityType: "ScheduledAutomation",
    entityId: automation.id,
    after: { at: data.at.toISOString(), reason: data.reason },
  });
  await recordEvent(ctx, {
    type: "RECALL_REQUESTED",
    source: "USER",
    ...linksOf(ref),
    payload: { scheduledFor: data.at.toISOString(), reason: data.reason },
  });

  await reconcileSubject(ctx.organizationId, ref, { actorId: ctx.userId });
  return getRecordActionState(ctx, ref);
}

export async function cancelRecordAutomation(ctx: ActorContext, ref: SubjectRef, automationId: string, reason: string) {
  assertWritable(ctx, ref.kind);
  await assertSubjectExists(ctx, ref);
  await cancelAutomation(ctx, automationId, reason || "Manuell gestoppt.");
  await logSystemActivity(ctx, {
    subject: "Automation gestoppt",
    body: reason,
    links: linksOf(ref),
    metadata: { automationId },
  });
  await writeAudit(ctx, {
    action: "automation.cancelled",
    entityType: "ScheduledAutomation",
    entityId: automationId,
    after: { reason },
  });
  await reconcileSubject(ctx.organizationId, ref, { actorId: ctx.userId });
  return getRecordActionState(ctx, ref);
}

/** Pauses every automation for one record, with a reason and an end date. */
export async function pauseRecordAutomation(ctx: ActorContext, ref: SubjectRef, input: z.input<typeof pauseSchema>) {
  assertWritable(ctx, ref.kind);
  const data = pauseSchema.parse(input);
  if (data.until.getTime() <= Date.now()) throw ValidationError("Das Ende der Pause muss in der Zukunft liegen.");
  await assertSubjectExists(ctx, ref);

  const patch = { automationPausedUntil: data.until, automationPausedReason: data.reason };
  if (ref.kind === "DEAL") {
    await prisma.deal.updateMany({ where: { id: ref.id, ...scope(ctx) }, data: patch });
  } else {
    await prisma.lead.updateMany({ where: { id: ref.id, ...scope(ctx) }, data: patch });
  }

  await logSystemActivity(ctx, {
    subject: `Automation pausiert bis ${data.until.toLocaleDateString("de-DE")}`,
    body: data.reason,
    links: linksOf(ref),
  });
  await writeAudit(ctx, {
    action: "automation.paused",
    entityType: ref.kind === "DEAL" ? "Deal" : "Lead",
    entityId: ref.id,
    after: { until: data.until.toISOString(), reason: data.reason },
  });
  return getRecordActionState(ctx, ref);
}

export async function resumeRecordAutomation(ctx: ActorContext, ref: SubjectRef) {
  assertWritable(ctx, ref.kind);
  await assertSubjectExists(ctx, ref);
  const patch = { automationPausedUntil: null, automationPausedReason: null };
  if (ref.kind === "DEAL") {
    await prisma.deal.updateMany({ where: { id: ref.id, ...scope(ctx) }, data: patch });
  } else {
    await prisma.lead.updateMany({ where: { id: ref.id, ...scope(ctx) }, data: patch });
  }
  await logSystemActivity(ctx, { subject: "Automation fortgesetzt", links: linksOf(ref) });
  await writeAudit(ctx, {
    action: "automation.resumed",
    entityType: ref.kind === "DEAL" ? "Deal" : "Lead",
    entityId: ref.id,
  });
  await reconcileSubject(ctx.organizationId, ref, { actorId: ctx.userId });
  return getRecordActionState(ctx, ref);
}
