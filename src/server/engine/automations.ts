import type { Prisma } from "@/generated/prisma/client";
import type { AutomationType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { ActorContext } from "@/lib/context";
import { logError } from "@/lib/logger";
import { notify } from "@/server/services/notifications";
import { sendTemplatedEmailForAutomation } from "@/server/services/emails";
import { defaultOutboundGuards, evaluateGuards, parseGuards, type AutomationGuard } from "./guards";
import { loadEngineConfig } from "./settings";
import { loadSubject, type SubjectRef } from "./subject";
import { recordEvent } from "./events";
import { reconcileSafely } from "./next-actions";
import { systemContextFor } from "./system-context";

/**
 * Scheduled automations: the part of the product that actually takes work off
 * the user. Three rules hold for all of them —
 *
 *  1. every automation carries the reason it exists, shown wherever it appears;
 *  2. its guards are re-evaluated immediately before execution, never at
 *     scheduling time only;
 *  3. an outcome is always recorded, including why something was skipped.
 */
export type ScheduleInput = {
  type: AutomationType;
  scheduledFor: Date;
  reason: string;
  ruleKey?: string | null;
  guards?: AutomationGuard[];
  payload?: Record<string, unknown>;
  ownerId?: string | null;
  templateId?: string | null;
  createdById?: string | null;
  /** Prevents duplicates: an existing pending automation of this key is reused. */
  dedupeKey?: string;
};

export async function scheduleAutomation(
  organizationId: string,
  ref: SubjectRef,
  input: ScheduleInput,
): Promise<{ id: string; created: boolean }> {
  const where = ref.kind === "DEAL" ? { dealId: ref.id } : { leadId: ref.id };

  const existing = await prisma.scheduledAutomation.findFirst({
    where: {
      organizationId,
      ...where,
      status: "PENDING",
      type: input.type,
      ...(input.dedupeKey ? { ruleKey: input.dedupeKey } : { ruleKey: input.ruleKey ?? null }),
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const automation = await prisma.scheduledAutomation.create({
    data: {
      organizationId,
      type: input.type,
      scheduledFor: input.scheduledFor,
      reason: input.reason,
      ruleKey: input.dedupeKey ?? input.ruleKey ?? null,
      guards: (input.guards ?? defaultOutboundGuards(new Date())) as unknown as Prisma.InputJsonValue,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      ownerId: input.ownerId ?? null,
      templateId: input.templateId ?? null,
      createdById: input.createdById ?? null,
      ...where,
    },
    select: { id: true },
  });

  return { id: automation.id, created: true };
}

export type AutomationOutcome = {
  id: string;
  status: "EXECUTED" | "SKIPPED" | "CANCELLED" | "FAILED" | "DEFERRED";
  reason?: string;
};

/**
 * Runs everything that is due. Called by the scheduler endpoint; safe to call
 * repeatedly, because each automation is claimed before it is executed.
 */
export async function runDueAutomations(
  options: { organizationId?: string; now?: Date; limit?: number } = {},
): Promise<AutomationOutcome[]> {
  const now = options.now ?? new Date();
  const due = await prisma.scheduledAutomation.findMany({
    where: {
      status: "PENDING",
      scheduledFor: { lte: now },
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
    },
    orderBy: { scheduledFor: "asc" },
    take: options.limit ?? 100,
  });

  const outcomes: AutomationOutcome[] = [];
  for (const automation of due) {
    try {
      outcomes.push(await runAutomation(automation.id, now));
    } catch (error) {
      logError("engine.automation_failed", error, { automationId: automation.id });
      await prisma.scheduledAutomation.update({
        where: { id: automation.id },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          outcomeReason: error instanceof Error ? error.message.slice(0, 500) : "Unbekannter Fehler",
        },
      });
      outcomes.push({ id: automation.id, status: "FAILED" });
    }
  }
  return outcomes;
}

export async function runAutomation(automationId: string, now = new Date()): Promise<AutomationOutcome> {
  // Claim it first: two schedulers may overlap, only one may execute.
  const claimed = await prisma.scheduledAutomation.updateMany({
    where: { id: automationId, status: "PENDING" },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return { id: automationId, status: "SKIPPED", reason: "Bereits verarbeitet." };

  const automation = await prisma.scheduledAutomation.findUnique({ where: { id: automationId } });
  if (!automation) return { id: automationId, status: "SKIPPED", reason: "Nicht gefunden." };

  const ref: SubjectRef | null = automation.dealId
    ? { kind: "DEAL", id: automation.dealId }
    : automation.leadId
      ? { kind: "LEAD", id: automation.leadId }
      : null;

  if (!ref) {
    return finish(automation.id, "SKIPPED", "Die Automation ist mit keinem Datensatz verknüpft.");
  }

  const [subject, config] = await Promise.all([
    loadSubject(automation.organizationId, ref),
    loadEngineConfig(automation.organizationId),
  ]);
  if (!subject) return finish(automation.id, "CANCELLED", "Der verknüpfte Datensatz existiert nicht mehr.");

  if (!config.thresholds.automationEnabled) {
    return finish(automation.id, "SKIPPED", "Automatisierung ist für diese Organisation deaktiviert.");
  }

  const guardOutcome = evaluateGuards(parseGuards(automation.guards), subject, config.thresholds, now);
  if (guardOutcome.result === "skip") {
    await recordEvent(
      { organizationId: automation.organizationId, userId: automation.ownerId },
      {
        type: "AUTOMATION_CANCELLED",
        source: "AUTOMATION",
        dealId: automation.dealId,
        leadId: automation.leadId,
        payload: { automationId: automation.id, reason: guardOutcome.reason },
      },
    );
    return finish(automation.id, "SKIPPED", guardOutcome.reason);
  }
  if (guardOutcome.result === "defer") {
    await prisma.scheduledAutomation.update({
      where: { id: automation.id },
      data: { scheduledFor: guardOutcome.until, outcomeReason: guardOutcome.reason },
    });
    return { id: automation.id, status: "DEFERRED", reason: guardOutcome.reason };
  }

  const ctx = await systemContextFor(automation.organizationId, [automation.ownerId, automation.createdById, subject.ownerId]);
  if (!ctx) return finish(automation.id, "SKIPPED", "Kein aktives Mitglied für die Ausführung gefunden.");

  const executed = await execute(ctx, automation, subject.label, ref);
  if (!executed.ok) return finish(automation.id, "SKIPPED", executed.reason);

  await prisma.scheduledAutomation.update({
    where: { id: automation.id },
    data: { status: "EXECUTED", executedAt: now, outcomeReason: executed.reason ?? null },
  });

  await recordEvent(ctx, {
    type: "AUTOMATION_EXECUTED",
    source: "AUTOMATION",
    dealId: automation.dealId,
    leadId: automation.leadId,
    payload: { automationId: automation.id, type: automation.type, reason: automation.reason },
  });

  await reconcileSafely(automation.organizationId, ref);
  return { id: automation.id, status: "EXECUTED", reason: executed.reason };
}

async function finish(
  id: string,
  status: "SKIPPED" | "CANCELLED" | "FAILED",
  reason: string,
): Promise<AutomationOutcome> {
  await prisma.scheduledAutomation.update({
    where: { id },
    data: {
      status,
      outcomeReason: reason,
      ...(status === "CANCELLED" ? { cancelledAt: new Date() } : {}),
    },
  });
  return { id, status, reason };
}

type ExecutionResult = { ok: true; reason?: string } | { ok: false; reason: string };

async function execute(
  ctx: ActorContext,
  automation: { id: string; type: AutomationType; reason: string; dealId: string | null; leadId: string | null; ownerId: string | null; templateId: string | null; payload: unknown },
  subjectLabel: string,
  ref: SubjectRef,
): Promise<ExecutionResult> {
  switch (automation.type) {
    case "FOLLOW_UP_EMAIL": {
      if (!automation.templateId) return { ok: false, reason: "Keine E-Mail-Vorlage hinterlegt." };
      const result = await sendTemplatedEmailForAutomation(ctx, {
        templateId: automation.templateId,
        objectType: ref.kind === "DEAL" ? "DEAL" : "LEAD",
        entityId: ref.id,
        toField: ref.kind === "DEAL" ? "contact.email" : "lead.email",
      });
      if (!result.sent) return { ok: false, reason: result.reason ?? "E-Mail konnte nicht gesendet werden." };
      return { ok: true, reason: "E-Mail gesendet." };
    }

    case "FOLLOW_UP_TASK":
    case "RECALL":
    case "REMINDER": {
      const title =
        automation.type === "RECALL"
          ? `Wiedervorlage: ${subjectLabel}`
          : automation.type === "REMINDER"
            ? `Erinnerung: ${subjectLabel}`
            : `Nachfassen: ${subjectLabel}`;

      const task = await prisma.task.create({
        data: {
          organizationId: ctx.organizationId,
          title,
          description: automation.reason,
          status: "OPEN",
          priority: "HIGH",
          dueAt: new Date(),
          ownerId: automation.ownerId ?? ctx.userId,
          createdById: ctx.userId,
          ...(ref.kind === "DEAL" ? { dealId: ref.id } : { leadId: ref.id }),
        },
        select: { id: true, ownerId: true },
      });

      // Tie the task to the open next action so completing one closes the other.
      await prisma.nextAction.updateMany({
        where: {
          organizationId: ctx.organizationId,
          ...(ref.kind === "DEAL" ? { dealId: ref.id } : { leadId: ref.id }),
          status: "OPEN",
          taskId: null,
        },
        data: { taskId: task.id },
      });

      if (task.ownerId) {
        await notify(ctx, {
          userId: task.ownerId,
          type: "TASK_ASSIGNED",
          title,
          body: automation.reason,
          link: ref.kind === "DEAL" ? `/deals/${ref.id}` : `/leads/${ref.id}`,
          entityType: "Task",
          entityId: task.id,
        });
      }
      return { ok: true, reason: "Aufgabe erstellt." };
    }

    default:
      return { ok: false, reason: "Unbekannter Automationstyp." };
  }
}

export async function cancelAutomation(ctx: ActorContext, id: string, reason: string): Promise<void> {
  await prisma.scheduledAutomation.updateMany({
    where: { id, organizationId: ctx.organizationId, status: "PENDING" },
    data: { status: "CANCELLED", cancelledAt: new Date(), outcomeReason: reason },
  });
}

export async function listAutomations(organizationId: string, ref: SubjectRef) {
  const where = ref.kind === "DEAL" ? { dealId: ref.id } : { leadId: ref.id };
  return prisma.scheduledAutomation.findMany({
    where: { organizationId, ...where },
    orderBy: [{ status: "asc" }, { scheduledFor: "asc" }],
    take: 50,
  });
}
