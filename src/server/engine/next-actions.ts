import type { Prisma } from "@/generated/prisma/client";
import type { NextActionType, OperationalState } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logger";
import { loadEngineConfig } from "./settings";
import { computeMomentum } from "./momentum";
import { evaluateRules } from "./rules";
import { loadSubject, type SubjectRef } from "./subject";
import { syncFollowUpAutomation } from "./follow-ups";
import type { EngineSubject, NextActionProposal } from "./types";

/**
 * Reconciliation is the heart of the Active CRM layer: it takes the current
 * snapshot of a record and makes the stored next action, operational state and
 * momentum match it. It is idempotent — running it twice changes nothing the
 * second time — so it can be called after every event, from a sweep, or by
 * hand, without side effects piling up.
 */

export type ReconcileResult = {
  subject: EngineSubject;
  operationalState: OperationalState;
  nextActionId: string | null;
  proposal: NextActionProposal | null;
  changed: boolean;
};

const MINUTE = 60 * 1000;

function sameMoment(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a.getTime() - b.getTime()) < MINUTE;
}

function linkFor(subject: EngineSubject) {
  return subject.kind === "DEAL"
    ? { dealId: subject.id, leadId: null }
    : { dealId: null, leadId: subject.id };
}

function whereFor(ref: SubjectRef) {
  return ref.kind === "DEAL" ? { dealId: ref.id } : { leadId: ref.id };
}

/** Closes out a record that is no longer open: no dangling actions, no pending automations. */
async function closeOut(organizationId: string, subject: EngineSubject): Promise<ReconcileResult> {
  const where = whereFor({ kind: subject.kind, id: subject.id });
  const reason = subject.kind === "DEAL" ? "Deal ist abgeschlossen." : "Lead ist konvertiert.";

  await prisma.$transaction(async (tx) => {
    await tx.nextAction.updateMany({
      where: { organizationId, ...where, status: { in: ["OPEN", "SNOOZED"] } },
      data: { status: "SUPERSEDED" },
    });
    await tx.scheduledAutomation.updateMany({
      where: { organizationId, ...where, status: "PENDING" },
      data: { status: "CANCELLED", cancelledAt: new Date(), outcomeReason: reason },
    });
    const data = {
      operationalState: "CLOSED" as const,
      nextActionAt: null,
      nextActionType: null,
      nextActionTitle: null,
      stalledSince: null,
    };
    if (subject.kind === "DEAL") {
      await tx.deal.updateMany({ where: { id: subject.id, organizationId }, data });
    } else {
      await tx.lead.updateMany({ where: { id: subject.id, organizationId }, data });
    }
  });

  return { subject, operationalState: "CLOSED", nextActionId: null, proposal: null, changed: true };
}

export async function reconcileSubject(
  organizationId: string,
  ref: SubjectRef,
  options: { actorId?: string | null; now?: Date } = {},
): Promise<ReconcileResult | null> {
  const now = options.now ?? new Date();
  const subject = await loadSubject(organizationId, ref);
  if (!subject) return null;
  if (!subject.isOpen) return closeOut(organizationId, subject);

  const config = await loadEngineConfig(organizationId);
  const momentum = computeMomentum(subject, config.thresholds, now);

  // A manual decision always wins over the catalogue — the user is the
  // authority, the engine only fills the gaps.
  const manual = subject.manualAction;
  const proposal: NextActionProposal = manual
    ? {
        ruleKey: "manual",
        type: manual.type,
        title: manual.title,
        reason: manual.reason,
        dueAt: manual.snoozedUntil ?? manual.dueAt,
        priority: manual.priority,
        operationalState:
          (manual.snoozedUntil ?? manual.dueAt ?? now).getTime() > now.getTime() ? "SCHEDULED" : "WAITING_FOR_US",
      }
    : evaluateRules(subject, config.thresholds, config.overrides, now).proposal;

  const where = whereFor(ref);
  const existing = await prisma.nextAction.findFirst({
    where: { organizationId, ...where, status: { in: ["OPEN", "SNOOZED"] }, isManual: false },
    orderBy: { createdAt: "desc" },
  });

  let nextActionId = manual?.id ?? existing?.id ?? null;
  let changed = false;

  if (manual) {
    // The engine keeps no competing proposal alongside a manual action.
    if (existing) {
      await prisma.nextAction.update({ where: { id: existing.id }, data: { status: "SUPERSEDED" } });
      changed = true;
    }
    // A snooze that has run out turns the action back into an open one.
    if (manual.snoozedUntil && manual.snoozedUntil.getTime() <= now.getTime()) {
      await prisma.nextAction.update({
        where: { id: manual.id },
        data: { status: "OPEN", snoozedUntil: null, dueAt: manual.snoozedUntil },
      });
      changed = true;
    }
  } else {
    const matches =
      existing &&
      existing.ruleKey === proposal.ruleKey &&
      existing.type === proposal.type &&
      sameMoment(existing.dueAt, proposal.dueAt);

    if (matches && existing) {
      if (existing.reason !== proposal.reason || existing.priority !== proposal.priority) {
        await prisma.nextAction.update({
          where: { id: existing.id },
          data: { reason: proposal.reason, priority: proposal.priority, ownerId: subject.ownerId },
        });
        changed = true;
      }
    } else {
      const created = await prisma.$transaction(async (tx) => {
        if (existing) {
          await tx.nextAction.update({ where: { id: existing.id }, data: { status: "SUPERSEDED" } });
        }
        return tx.nextAction.create({
          data: {
            organizationId,
            type: proposal.type,
            title: proposal.title,
            reason: proposal.reason,
            ruleKey: proposal.ruleKey,
            dueAt: proposal.dueAt,
            priority: proposal.priority,
            ownerId: subject.ownerId,
            contactId: subject.contactId,
            companyId: subject.companyId,
            ...linkFor(subject),
          },
        });
      });
      nextActionId = created.id;
      changed = true;
    }
  }

  const stalled = momentum.momentum === "STALLED";
  const record = {
    operationalState: proposal.operationalState,
    nextActionAt: proposal.dueAt,
    nextActionType: proposal.type,
    nextActionTitle: proposal.title,
    momentum: momentum.momentum,
    momentumSignals: momentum.signals as unknown as Prisma.InputJsonValue,
  };

  if (subject.kind === "DEAL") {
    const current = await prisma.deal.findFirst({ where: { id: subject.id, organizationId }, select: { stalledSince: true } });
    await prisma.deal.updateMany({
      where: { id: subject.id, organizationId },
      data: { ...record, stalledSince: stalled ? (current?.stalledSince ?? now) : null },
    });
  } else {
    const current = await prisma.lead.findFirst({ where: { id: subject.id, organizationId }, select: { stalledSince: true } });
    await prisma.lead.updateMany({
      where: { id: subject.id, organizationId },
      data: { ...record, stalledSince: stalled ? (current?.stalledSince ?? now) : null },
    });
  }

  await syncFollowUpAutomation(organizationId, ref, subject, proposal, config.thresholds, now);

  return { subject, operationalState: proposal.operationalState, nextActionId, proposal, changed };
}

/** Reconciliation never breaks the request that triggered it. */
export async function reconcileSafely(
  organizationId: string,
  ref: SubjectRef,
  options: { actorId?: string | null; now?: Date } = {},
): Promise<void> {
  try {
    await reconcileSubject(organizationId, ref, options);
  } catch (error) {
    logError("engine.reconcile_failed", error, { kind: ref.kind, id: ref.id });
  }
}

export type ManualActionInput = {
  type: NextActionType;
  title: string;
  reason: string;
  dueAt?: Date | null;
  priority?: number;
  ownerId?: string | null;
};
