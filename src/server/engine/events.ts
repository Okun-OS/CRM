import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { CrmEventType, EventSource } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logger";
import { EVENT_EFFECTS, type EventEffect, type EventPatch } from "./effects";
import { reconcileSafely } from "./next-actions";
import type { SubjectRef } from "./subject";

/**
 * The event model — step one of the Active CRM layer.
 *
 * Everything the system reacts to is written here first, exactly once, and
 * only then turned into timeline entries, state changes and next actions.
 * That gives three things the product promises: idempotent ingestion (an
 * integration may deliver the same event twice), a traceable history of why
 * the CRM did something, and one place to extend when new sources are
 * connected.
 */
export type EngineActor = { organizationId: string; userId?: string | null };

export type RecordEventInput = {
  type: CrmEventType;
  source?: EventSource;
  /** Stable key for the logical event; a repeat delivery is ignored. */
  idempotencyKey?: string;
  occurredAt?: Date;
  actorId?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  payload?: Record<string, unknown>;
  /** The caller already wrote the timeline entry (e.g. a manually logged call). */
  suppressActivity?: boolean;
};

export type RecordEventResult = { id: string | null; duplicate: boolean };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

function subjectRef(input: { dealId?: string | null; leadId?: string | null }): SubjectRef | null {
  if (input.dealId) return { kind: "DEAL", id: input.dealId };
  if (input.leadId) return { kind: "LEAD", id: input.leadId };
  return null;
}

/**
 * Writes the event and applies its consequences. Never throws into the caller:
 * a failed reaction is recorded on the event row and logged, the originating
 * action stays valid.
 */
export async function recordEvent(actor: EngineActor, input: RecordEventInput): Promise<RecordEventResult> {
  const occurredAt = input.occurredAt ?? new Date();
  const idempotencyKey = input.idempotencyKey ?? `${input.type}:${randomUUID()}`;

  let eventId: string;
  try {
    const event = await prisma.domainEventRecord.create({
      data: {
        organizationId: actor.organizationId,
        type: input.type,
        source: input.source ?? "SYSTEM",
        idempotencyKey,
        occurredAt,
        actorId: input.actorId ?? actor.userId ?? null,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
        dealId: input.dealId ?? null,
        leadId: input.leadId ?? null,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    eventId = event.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await prisma.domainEventRecord.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: actor.organizationId, idempotencyKey } },
        select: { id: true },
      });
      return { id: existing?.id ?? null, duplicate: true };
    }
    throw error;
  }

  try {
    await applyEffects(actor, { ...input, occurredAt, eventId });
    await prisma.domainEventRecord.update({ where: { id: eventId }, data: { processedAt: new Date() } });
  } catch (error) {
    logError("engine.event_processing_failed", error, { type: input.type, eventId });
    await prisma.domainEventRecord
      .update({
        where: { id: eventId },
        data: { processingError: error instanceof Error ? error.message.slice(0, 500) : "Unbekannter Fehler" },
      })
      .catch(() => undefined);
  }

  return { id: eventId, duplicate: false };
}

type EffectInput = RecordEventInput & { occurredAt: Date; eventId: string };

async function applyEffects(actor: EngineActor, input: EffectInput): Promise<void> {
  const effect = EVENT_EFFECTS[input.type];
  const ref = subjectRef(input);

  if (effect?.activity && !input.suppressActivity) {
    await writeTimelineEntry(actor, input, effect.activity);
  }
  if (effect?.patch && ref) {
    await applyPatch(actor.organizationId, ref, effect.patch(input.occurredAt, input.payload ?? {}));
  }
  if (effect?.cancels && ref) {
    await cancelPendingAutomations(actor.organizationId, ref, effect.cancels.reason, effect.cancels.types);
  }
  if (effect?.closesEngineTasks && ref) {
    await closeEngineTasks(actor, ref, effect.closesEngineTasks);
  }

  if (ref) {
    await reconcileSafely(actor.organizationId, ref, { actorId: input.actorId ?? actor.userId ?? null });
  }
}

async function writeTimelineEntry(
  actor: EngineActor,
  input: EffectInput,
  activity: EventEffect["activity"],
): Promise<void> {
  if (!activity) return;
  if (!input.contactId && !input.companyId && !input.dealId && !input.leadId) return;

  await prisma.activity.create({
    data: {
      organizationId: actor.organizationId,
      type: activity.type,
      source: "SYSTEM",
      subject: activity.subject(input.payload ?? {}),
      direction: activity.direction,
      occurredAt: input.occurredAt,
      actorId: input.actorId ?? actor.userId ?? null,
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      dealId: input.dealId ?? null,
      leadId: input.leadId ?? null,
      metadata: { eventId: input.eventId, eventType: input.type } as Prisma.InputJsonValue,
    },
  });
}

/** Deal-only columns are dropped for leads rather than failing the event. */
async function applyPatch(organizationId: string, ref: SubjectRef, patch: EventPatch): Promise<void> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const data = Object.fromEntries(entries);

  if (ref.kind === "DEAL") {
    await prisma.deal.updateMany({ where: { id: ref.id, organizationId }, data });
    return;
  }
  const { offerSentAt: _offer, stageEnteredAt: _stage, ...leadData } = data as Record<string, unknown>;
  if (Object.keys(leadData).length === 0) return;
  await prisma.lead.updateMany({ where: { id: ref.id, organizationId }, data: leadData });
}

export async function cancelPendingAutomations(
  organizationId: string,
  ref: SubjectRef,
  reason: string,
  types?: string[],
): Promise<number> {
  const where = ref.kind === "DEAL" ? { dealId: ref.id } : { leadId: ref.id };
  const result = await prisma.scheduledAutomation.updateMany({
    where: {
      organizationId,
      ...where,
      status: "PENDING",
      ...(types?.length ? { type: { in: types as never } } : {}),
    },
    data: { status: "CANCELLED", cancelledAt: new Date(), outcomeReason: reason },
  });
  return result.count;
}

/**
 * Automatic task closure: tasks the engine created become pointless when
 * reality moves on. Tasks a person created by hand are never touched.
 */
async function closeEngineTasks(actor: EngineActor, ref: SubjectRef, reason: string): Promise<void> {
  const where = ref.kind === "DEAL" ? { dealId: ref.id } : { leadId: ref.id };
  const tasks = await prisma.task.findMany({
    where: {
      organizationId: actor.organizationId,
      ...where,
      deletedAt: null,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      nextActions: { some: { organizationId: actor.organizationId, isManual: false } },
    },
    select: { id: true, title: true },
  });
  if (tasks.length === 0) return;

  const now = new Date();
  await prisma.$transaction([
    prisma.task.updateMany({
      where: { id: { in: tasks.map((task) => task.id) } },
      data: { status: "COMPLETED", completedAt: now },
    }),
    prisma.nextAction.updateMany({
      where: {
        organizationId: actor.organizationId,
        taskId: { in: tasks.map((task) => task.id) },
        status: { in: ["OPEN", "SNOOZED"] },
      },
      data: { status: "SUPERSEDED" },
    }),
    prisma.activity.create({
      data: {
        organizationId: actor.organizationId,
        type: "SYSTEM",
        source: "SYSTEM",
        subject: `Automatisch geschlossen: ${tasks.map((task) => task.title).join(", ")}`,
        body: reason,
        occurredAt: now,
        ...(ref.kind === "DEAL" ? { dealId: ref.id } : { leadId: ref.id }),
      },
    }),
  ]);
}

/** Reads the raw event history of a record — the basis of every explanation. */
export async function listRecordEvents(organizationId: string, ref: SubjectRef, take = 50) {
  const where = ref.kind === "DEAL" ? { dealId: ref.id } : { leadId: ref.id };
  return prisma.domainEventRecord.findMany({
    where: { organizationId, ...where },
    orderBy: { occurredAt: "desc" },
    take,
    include: { actor: { select: { id: true, name: true } } },
  });
}
