import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logger";
import { emitDomainEvent } from "@/lib/events";
import { renderTemplate, type TemplateVariables } from "@/lib/templates";
import { systemContextFor } from "@/server/engine/system-context";
import { resolveEmailTransport } from "@/server/integrations/email";
import { createTask } from "@/server/services/tasks";
import { checkSuppression } from "./suppression";
import { stopEnrollmentInternal } from "./enrollment";
import { canSendNow, nextGapMs } from "./sending-accounts";
import type { ActorContext } from "@/lib/context";

/**
 * Der Läufer: führt fällige Sequenzschritte aus.
 *
 * Wird vom vorhandenen Sweep aufgerufen, nicht von einer eigenen Warteschlange.
 * Drei Eigenschaften machen ihn belastbar:
 *
 * 1. **Idempotent.** Ein Lauf wird über `updateMany` mit Statusbedingung
 *    beansprucht. Zwei gleichzeitige Durchläufe können denselben Schritt nicht
 *    zweimal senden.
 * 2. **Bedingungen unmittelbar vor der Ausführung.** Kontaktsperre, Stufe und
 *    Sendefenster werden jetzt geprüft, nicht beim Planen. Was zwischenzeitlich
 *    gegenstandslos wurde, wird nicht mehr gesendet.
 * 3. **Nie stillschweigend.** Jeder übersprungene oder fehlgeschlagene Lauf
 *    trägt seinen Grund.
 */
export type RunnerResult = {
  executed: number;
  skipped: number;
  deferred: number;
  failed: number;
};

const BATCH = 100;

export async function runDueSequenceSteps(organizationId: string, now = new Date()): Promise<RunnerResult> {
  const result: RunnerResult = { executed: 0, skipped: 0, deferred: 0, failed: 0 };

  const due = await prisma.enrollmentStepRun.findMany({
    where: { organizationId, status: "PENDING", scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: BATCH,
    include: DUE_RUN_INCLUDE,
  });

  for (const run of due) {
    try {
      const outcome = await executeRun(organizationId, run, now);
      result[outcome] += 1;
    } catch (error) {
      result.failed += 1;
      logError("acquisition.step_failed", error, { runId: run.id });
      await prisma.enrollmentStepRun.updateMany({
        where: { id: run.id, status: "PENDING" },
        data: {
          status: "FAILED",
          attempts: { increment: 1 },
          outcomeReason: error instanceof Error ? error.message.slice(0, 300) : "Unbekannter Fehler",
        },
      });
    }
  }

  return result;
}

/**
 * Ein fälliger Lauf mit allem, was zur Ausführung nötig ist.
 *
 * Als Typ aus der Abfrage abgeleitet, damit eine Änderung am `include` oben
 * hier sofort auffällt, statt still durchzurutschen.
 */
const DUE_RUN_INCLUDE = {
  step: true,
  enrollment: {
    include: {
      prospect: true,
      sequence: { include: { steps: { orderBy: { position: "asc" as const } }, sendingAccount: true } },
    },
  },
} satisfies Prisma.EnrollmentStepRunInclude;

type DueRun = Prisma.EnrollmentStepRunGetPayload<{ include: typeof DUE_RUN_INCLUDE }>;

type Outcome = "executed" | "skipped" | "deferred" | "failed";

async function executeRun(organizationId: string, run: DueRun, now: Date): Promise<Outcome> {
  const { enrollment, step } = run;
  const { prospect, sequence } = enrollment;

  const ctx = await systemContextFor(organizationId, [enrollment.enrolledById, prospect.ownerId, sequence.ownerId]);
  if (!ctx) {
    await skip(run.id, "Kein handlungsfähiges Mitglied in dieser Organisation gefunden.");
    return "skipped";
  }

  /* ── Bedingungen, die zwischenzeitlich eingetreten sein können ───────── */
  if (enrollment.status !== "ACTIVE") {
    await skip(run.id, "Die Einschreibung läuft nicht mehr.");
    return "skipped";
  }
  if (sequence.status !== "ACTIVE") {
    await defer(run.id, now, 6 * 3600_000, `Die Sequenz ist ${sequence.status === "PAUSED" ? "pausiert" : "nicht aktiv"}.`);
    return "deferred";
  }

  const suppression = await checkSuppression(organizationId, prospect.email);
  if (suppression.blocked) {
    await skip(run.id, suppression.reason);
    await stopEnrollmentInternal(ctx, enrollment.id, "SUPPRESSED", suppression.reason);
    return "skipped";
  }

  /* ── Ausführung je Schritttyp ────────────────────────────────────────── */
  switch (step.type) {
    case "WAIT":
      await complete(run.id, "Wartezeit abgelaufen.");
      break;

    case "TASK":
    case "CALL_TASK": {
      const task = await createTask(ctx, {
        title: step.taskTitle ?? "Sequenzschritt",
        description: [step.taskDescription, `Aus der Sequenz „${sequence.name}".`].filter(Boolean).join("\n\n"),
        priority: step.type === "CALL_TASK" ? "HIGH" : "MEDIUM",
        dueAt: new Date(now.getTime() + 86_400_000).toISOString(),
        ownerId: prospect.ownerId ?? ctx.userId,
      });
      await prisma.enrollmentStepRun.updateMany({
        where: { id: run.id, status: "PENDING" },
        data: { status: "SENT", executedAt: now, taskId: task.id, outcomeReason: "Aufgabe erstellt." },
      });
      break;
    }

    case "MANUAL_EMAIL": {
      // Eine Nachricht, die ein Mensch abschicken soll — die Engine bereitet
      // sie vor und legt sie als Aufgabe hin, statt selbst zu senden.
      const task = await createTask(ctx, {
        title: `E-Mail an ${prospect.companyName} senden`,
        description: [
          step.subject ? `Betreff: ${step.subject}` : null,
          `Adresse: ${prospect.email ?? "unbekannt"}`,
          `Aus der Sequenz „${sequence.name}".`,
        ]
          .filter(Boolean)
          .join("\n"),
        priority: "MEDIUM",
        dueAt: new Date(now.getTime() + 86_400_000).toISOString(),
        ownerId: prospect.ownerId ?? ctx.userId,
      });
      await prisma.enrollmentStepRun.updateMany({
        where: { id: run.id, status: "PENDING" },
        data: { status: "SENT", executedAt: now, taskId: task.id, outcomeReason: "Als Aufgabe vorbereitet." },
      });
      break;
    }

    case "CONDITION":
      // Ohne ausgewertete Bedingung wird nicht geraten, sondern weitergegangen
      // und der Grund festgehalten.
      await complete(run.id, "Bedingungsschritte werden derzeit übergangen.");
      break;

    case "CRM_ACTION":
      await complete(run.id, "CRM-Aktionen sind noch nicht umgesetzt.");
      break;

    case "AUTOMATED_EMAIL": {
      const outcome = await sendStepEmail(ctx, run, now);
      if (outcome !== "executed") return outcome;
      break;
    }
  }

  await advance(ctx, run, now);
  return "executed";
}

/* ── E-Mail-Schritt ──────────────────────────────────────────────────────── */

async function sendStepEmail(ctx: ActorContext, run: DueRun, now: Date): Promise<Outcome> {
  const { enrollment, step } = run;
  const { prospect, sequence } = enrollment;

  if (!prospect.email) {
    await skip(run.id, "Keine E-Mail-Adresse hinterlegt.");
    await stopEnrollmentInternal(ctx, enrollment.id, "MANUAL", "Keine E-Mail-Adresse.");
    return "skipped";
  }

  const account =
    sequence.sendingAccount ??
    (await prisma.sendingAccount.findFirst({
      where: { organizationId: ctx.organizationId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    }));

  if (!account) {
    await defer(run.id, now, 3600_000, "Kein aktives Versandkonto vorhanden.");
    return "deferred";
  }

  const decision = await canSendNow(ctx.organizationId, account, now);
  if (!decision.ok) {
    // Kein Fehler, sondern Absicht: Das Konto darf jetzt nicht senden.
    const wait = decision.retryAt ? Math.max(60_000, decision.retryAt.getTime() - now.getTime()) : 6 * 3600_000;
    await defer(run.id, now, wait, decision.reason);
    return "deferred";
  }

  const transport = await resolveEmailTransport(ctx);
  if (!transport.ok) {
    await defer(run.id, now, 3600_000, transport.reason);
    return "deferred";
  }

  /* ── Beanspruchen: ab hier kann kein zweiter Lauf dasselbe senden ────── */
  const claimed = await prisma.enrollmentStepRun.updateMany({
    where: { id: run.id, status: "PENDING" },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return "skipped";

  const variables = await templateVariables(ctx, prospect, account);
  const template = step.templateId
    ? await prisma.emailTemplate.findFirst({ where: { id: step.templateId, organizationId: ctx.organizationId } })
    : null;

  const subject = renderTemplate(template?.subject ?? step.subject ?? "", variables);
  const bodyBase = template?.bodyHtml ?? step.bodyHtml ?? "";
  const bodyHtml = renderTemplate(bodyBase, variables) + (account.signatureHtml ?? "");

  if (!subject.trim() || !bodyBase.trim()) {
    await skip(run.id, "Der Schritt hat weder Vorlage noch eigenen Inhalt.");
    return "skipped";
  }

  const message = await prisma.emailMessage.create({
    data: {
      organizationId: ctx.organizationId,
      direction: "OUTBOUND",
      status: "QUEUED",
      subject,
      bodyHtml,
      fromAddress: account.fromEmail,
      toAddresses: [prospect.email],
      ccAddresses: [],
      bccAddresses: [],
      templateId: template?.id ?? null,
      prospectId: prospect.id,
      enrollmentId: enrollment.id,
      stepRunId: run.id,
      sendingAccountId: account.id,
      threadKey: `${enrollment.id}`,
      createdById: ctx.userId,
    },
  });

  await emitDomainEvent(ctx, {
    name: "outreach.email_scheduled",
    entityType: "PROSPECT",
    entityId: prospect.id,
    payload: { messageId: message.id, sequenceId: sequence.id },
  });

  try {
    const sent = await transport.transport.send({
      from: `${account.fromName} <${account.fromEmail}>`,
      to: [prospect.email],
      subject,
      html: bodyHtml,
    });

    await prisma.$transaction([
      prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: "SENT", sentAt: now, providerMessageId: sent?.providerMessageId ?? null },
      }),
      prisma.enrollmentStepRun.update({
        where: { id: run.id },
        data: { status: "SENT", executedAt: now, sendingAccountId: account.id, outcomeReason: "Gesendet." },
      }),
      prisma.prospect.update({
        where: { id: prospect.id },
        data: {
          lastContactedAt: now,
          firstContactedAt: prospect.firstContactedAt ?? now,
        },
      }),
    ]);

    await emitDomainEvent(ctx, {
      name: "outreach.email_sent",
      entityType: "PROSPECT",
      entityId: prospect.id,
      payload: { messageId: message.id, sequenceId: sequence.id, subject },
    });

    return "executed";
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 300) : "Versand fehlgeschlagen";
    await prisma.emailMessage.update({ where: { id: message.id }, data: { status: "FAILED", error: reason } });
    await prisma.enrollmentStepRun.update({
      where: { id: run.id },
      data: { status: "FAILED", outcomeReason: reason },
    });
    return "failed";
  }
}

async function templateVariables(
  ctx: ActorContext,
  prospect: DueRun["enrollment"]["prospect"],
  account: { fromName: string; fromEmail: string },
): Promise<TemplateVariables> {
  const fullName = [prospect.firstName, prospect.lastName].filter(Boolean).join(" ");
  return {
    "prospect.firstName": prospect.firstName,
    "prospect.lastName": prospect.lastName,
    "prospect.fullName": fullName || prospect.companyName,
    "prospect.email": prospect.email,
    "prospect.jobTitle": prospect.jobTitle,
    "prospect.companyName": prospect.companyName,
    "prospect.domain": prospect.domain,
    "prospect.city": prospect.city,
    "prospect.industry": prospect.industry,
    "sender.name": account.fromName,
    "sender.email": account.fromEmail,
    "sender.company": ctx.organizationName,
    "organization.name": ctx.organizationName,
  };
}

/* ── Fortschritt ─────────────────────────────────────────────────────────── */

async function advance(ctx: ActorContext, run: DueRun, now: Date) {
  const { enrollment } = run;
  const steps = enrollment.sequence.steps;
  const nextIndex = enrollment.currentStep + 1;
  const next = steps[nextIndex];

  if (!next) {
    await stopEnrollmentInternal(ctx, enrollment.id, "FINISHED");
    return;
  }

  const account = enrollment.sequence.sendingAccount;
  const jitter = account ? nextGapMs(account) : 0;
  const scheduledFor = new Date(
    now.getTime() + next.delayDays * 86_400_000 + next.delayHours * 3_600_000 + jitter,
  );

  await prisma.$transaction(async (tx) => {
    await tx.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: { currentStep: nextIndex, nextStepAt: scheduledFor },
    });
    // Die Eindeutigkeit über (Einschreibung, Schritt) macht das Anlegen
    // wiederholbar: Ein zweiter Versuch erzeugt keinen zweiten Lauf.
    await tx.enrollmentStepRun.upsert({
      where: { enrollmentId_stepId: { enrollmentId: enrollment.id, stepId: next.id } },
      create: {
        organizationId: ctx.organizationId,
        enrollmentId: enrollment.id,
        stepId: next.id,
        scheduledFor,
      },
      update: {},
    });
  });
}

async function complete(runId: string, reason: string) {
  await prisma.enrollmentStepRun.updateMany({
    where: { id: runId, status: "PENDING" },
    data: { status: "SENT", executedAt: new Date(), outcomeReason: reason },
  });
}

async function skip(runId: string, reason: string) {
  await prisma.enrollmentStepRun.updateMany({
    where: { id: runId, status: "PENDING" },
    data: { status: "SKIPPED", outcomeReason: reason },
  });
}

async function defer(runId: string, now: Date, delayMs: number, reason: string) {
  await prisma.enrollmentStepRun.updateMany({
    where: { id: runId, status: "PENDING" },
    data: { scheduledFor: new Date(now.getTime() + delayMs), outcomeReason: reason },
  });
}
