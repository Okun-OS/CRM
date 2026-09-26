import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { Conflict, ValidationError } from "@/lib/api/errors";
import { filterGroupSchema } from "@/lib/filters";

/**
 * Sequenzen — mehrstufige Abläufe über Tage.
 *
 * Bewusst kein Workflow: Ein Workflow reagiert einmal auf ein Ereignis. Eine
 * Sequenz hat einen Zustand je Prospect, läuft über Wochen und muss auf
 * Ereignisse hin anhalten können. Das ist ein anderes Ding.
 */
const stepSchema = z
  .object({
    id: z.string().max(30).optional(),
    type: z.enum(["AUTOMATED_EMAIL", "MANUAL_EMAIL", "TASK", "CALL_TASK", "WAIT", "CONDITION", "CRM_ACTION"]),
    delayDays: z.coerce.number().int().min(0).max(365).default(0),
    delayHours: z.coerce.number().int().min(0).max(23).default(0),
    templateId: z.string().max(30).optional(),
    subject: z.string().trim().max(200).optional(),
    bodyHtml: z.string().trim().max(100_000).optional(),
    taskTitle: z.string().trim().max(200).optional(),
    taskDescription: z.string().trim().max(2000).optional(),
    condition: filterGroupSchema.optional(),
    actionConfig: z.record(z.string().max(48), z.unknown()).optional(),
  })
  .superRefine((step, ctx) => {
    // Jeder Schritttyp braucht genau das, was er zum Ausführen braucht —
    // geprüft beim Speichern, damit die Sequenz nicht nachts stehen bleibt.
    if (step.type === "AUTOMATED_EMAIL" || step.type === "MANUAL_EMAIL") {
      if (!step.templateId && !(step.subject && step.bodyHtml)) {
        ctx.addIssue({
          code: "custom",
          message: "Ein E-Mail-Schritt braucht eine Vorlage oder Betreff und Inhalt.",
          path: ["templateId"],
        });
      }
    }
    if ((step.type === "TASK" || step.type === "CALL_TASK") && !step.taskTitle) {
      ctx.addIssue({ code: "custom", message: "Ein Aufgabenschritt braucht einen Titel.", path: ["taskTitle"] });
    }
    if (step.type === "CONDITION" && !step.condition) {
      ctx.addIssue({ code: "custom", message: "Ein Bedingungsschritt braucht eine Bedingung.", path: ["condition"] });
    }
  });

export const sequenceInputSchema = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
  description: z.string().trim().max(1000).optional(),
  sendingAccountId: z.string().max(30).optional(),
  stopOnReply: z.boolean().default(true),
  stopOnMeeting: z.boolean().default(true),
  ownerId: z.string().max(30).optional(),
  steps: z.array(stepSchema).min(1, "Eine Sequenz braucht mindestens einen Schritt.").max(25),
});

const include = {
  steps: { orderBy: { position: "asc" } },
  sendingAccount: { select: { id: true, label: true, fromEmail: true, status: true } },
  owner: { select: { id: true, name: true } },
  _count: { select: { enrollments: true } },
} satisfies Prisma.SequenceInclude;

function present(row: Prisma.SequenceGetPayload<{ include: typeof include }>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    stopOnReply: row.stopOnReply,
    stopOnMeeting: row.stopOnMeeting,
    sendingAccount: row.sendingAccount,
    owner: row.owner,
    enrollmentCount: row._count.enrollments,
    steps: row.steps.map((step) => ({
      id: step.id,
      position: step.position,
      type: step.type,
      delayDays: step.delayDays,
      delayHours: step.delayHours,
      templateId: step.templateId,
      subject: step.subject,
      bodyHtml: step.bodyHtml,
      taskTitle: step.taskTitle,
      taskDescription: step.taskDescription,
      condition: step.condition,
      actionConfig: step.actionConfig,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type SequenceDTO = ReturnType<typeof present>;

export async function listSequences(ctx: ActorContext) {
  assertPermission(ctx, "outreach.sequences.read");
  const rows = await prisma.sequence.findMany({
    where: { ...scope(ctx), archivedAt: null },
    include,
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map(present);
}

export async function getSequence(ctx: ActorContext, id: string) {
  assertPermission(ctx, "outreach.sequences.read");
  const row = assertFound(
    await prisma.sequence.findFirst({ where: { id, ...scope(ctx) }, include }),
    "Die Sequenz wurde nicht gefunden.",
  );
  return present(row);
}

async function assertReferences(ctx: ActorContext, data: z.infer<typeof sequenceInputSchema>) {
  if (data.sendingAccountId) {
    const account = await prisma.sendingAccount.findFirst({ where: { id: data.sendingAccountId, ...scope(ctx) } });
    if (!account) throw ValidationError("Das angegebene Versandkonto wurde nicht gefunden.");
  }
  const templateIds = data.steps.map((step) => step.templateId).filter((id): id is string => Boolean(id));
  if (templateIds.length > 0) {
    const found = await prisma.emailTemplate.count({ where: { id: { in: templateIds }, ...scope(ctx) } });
    if (found !== new Set(templateIds).size) {
      throw ValidationError("Mindestens eine angegebene Vorlage wurde nicht gefunden.");
    }
  }
}

function stepData(ctx: ActorContext, step: z.infer<typeof stepSchema>, position: number) {
  return {
    organizationId: ctx.organizationId,
    position,
    type: step.type,
    delayDays: step.delayDays,
    delayHours: step.delayHours,
    templateId: step.templateId ?? null,
    subject: step.subject ?? null,
    bodyHtml: step.bodyHtml ?? null,
    taskTitle: step.taskTitle ?? null,
    taskDescription: step.taskDescription ?? null,
    condition: (step.condition ?? undefined) as Prisma.InputJsonValue | undefined,
    actionConfig: (step.actionConfig ?? undefined) as Prisma.InputJsonValue | undefined,
  };
}

export async function createSequence(ctx: ActorContext, input: z.input<typeof sequenceInputSchema>) {
  assertPermission(ctx, "outreach.sequences.manage");
  const data = sequenceInputSchema.parse(input);
  await assertReferences(ctx, data);

  const existing = await prisma.sequence.findFirst({ where: { ...scope(ctx), name: data.name } });
  if (existing) throw Conflict("Eine Sequenz mit diesem Namen existiert bereits.");

  const sequence = await prisma.sequence.create({
    data: {
      organizationId: ctx.organizationId,
      name: data.name,
      description: data.description,
      sendingAccountId: data.sendingAccountId,
      stopOnReply: data.stopOnReply,
      stopOnMeeting: data.stopOnMeeting,
      ownerId: data.ownerId ?? ctx.userId,
      createdById: ctx.userId,
      // Neu heißt Entwurf. Eine halbfertige Sequenz darf nicht auf echte
      // Menschen losgehen.
      status: "DRAFT",
      steps: { create: data.steps.map((step, index) => stepData(ctx, step, index)) },
    },
    include,
  });

  await writeAudit(ctx, {
    action: "sequence.created",
    entityType: "Sequence",
    entityId: sequence.id,
    after: { name: sequence.name, steps: sequence.steps.length },
  });

  return present(sequence);
}

export async function updateSequence(ctx: ActorContext, id: string, input: z.input<typeof sequenceInputSchema>) {
  assertPermission(ctx, "outreach.sequences.manage");
  const data = sequenceInputSchema.parse(input);
  await assertReferences(ctx, data);

  const existing = assertFound(
    await prisma.sequence.findFirst({ where: { id, ...scope(ctx) }, include: { steps: true } }),
    "Die Sequenz wurde nicht gefunden.",
  );

  // Schritte werden über ihre id erkannt; fehlt sie, entsteht ein neuer.
  // Entfernte Schritte gehen nur, wenn kein Lauf daran hängt — sonst verlöre
  // das Protokoll seinen Bezug.
  const keptIds = new Set(data.steps.map((step) => step.id).filter(Boolean) as string[]);
  const removed = existing.steps.filter((step) => !keptIds.has(step.id));

  if (removed.length > 0) {
    const runs = await prisma.enrollmentStepRun.count({ where: { stepId: { in: removed.map((step) => step.id) } } });
    if (runs > 0) {
      throw Conflict(
        `${runs} ausgeführte Schritte hängen an den zu entfernenden Stufen. Archivieren Sie die Sequenz stattdessen.`,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.sequence.update({
      where: { id: existing.id },
      data: {
        name: data.name,
        description: data.description,
        sendingAccountId: data.sendingAccountId ?? null,
        stopOnReply: data.stopOnReply,
        stopOnMeeting: data.stopOnMeeting,
        ownerId: data.ownerId ?? existing.ownerId,
      },
    });

    if (removed.length > 0) {
      await tx.sequenceStep.deleteMany({ where: { id: { in: removed.map((step) => step.id) } } });
    }

    for (const [index, step] of data.steps.entries()) {
      const match = step.id ? existing.steps.find((entry) => entry.id === step.id) : null;
      if (match) {
        await tx.sequenceStep.update({ where: { id: match.id }, data: stepData(ctx, step, index) });
      } else {
        await tx.sequenceStep.create({ data: { ...stepData(ctx, step, index), sequenceId: existing.id } });
      }
    }
  });

  await writeAudit(ctx, {
    action: "sequence.updated",
    entityType: "Sequence",
    entityId: existing.id,
    before: { name: existing.name, steps: existing.steps.length },
    after: { name: data.name, steps: data.steps.length },
  });

  return getSequence(ctx, existing.id);
}

/**
 * Schaltet eine Sequenz scharf oder hält sie an.
 *
 * Vor dem Scharfschalten wird geprüft, ob überhaupt gesendet werden kann —
 * eine aktive Sequenz ohne Versandweg würde reihenweise fehlschlagende
 * Schritte erzeugen und dabei aussehen, als liefe sie.
 */
export async function setSequenceStatus(ctx: ActorContext, id: string, status: "ACTIVE" | "PAUSED" | "ARCHIVED") {
  assertPermission(ctx, "outreach.sequences.manage");
  const existing = assertFound(
    await prisma.sequence.findFirst({
      where: { id, ...scope(ctx) },
      include: { steps: true, sendingAccount: true },
    }),
    "Die Sequenz wurde nicht gefunden.",
  );

  if (status === "ACTIVE") {
    if (existing.steps.length === 0) throw ValidationError("Diese Sequenz hat keine Schritte.");

    const needsSending = existing.steps.some((step) => step.type === "AUTOMATED_EMAIL");
    if (needsSending) {
      const account =
        existing.sendingAccount ??
        (await prisma.sendingAccount.findFirst({ where: { ...scope(ctx), status: "ACTIVE" } }));
      if (!account) {
        throw ValidationError(
          "Diese Sequenz versendet E-Mails, aber es ist kein aktives Versandkonto vorhanden. Bitte zuerst eines einrichten.",
        );
      }
      if (account.status !== "ACTIVE") {
        throw ValidationError(`Das Versandkonto „${account.label}" ist pausiert.`);
      }
    }
  }

  const sequence = await prisma.sequence.update({
    where: { id: existing.id },
    data: { status, archivedAt: status === "ARCHIVED" ? new Date() : null },
  });

  if (status === "ARCHIVED") {
    // Laufende Einschreibungen enden mit — sonst sendete eine archivierte
    // Sequenz weiter.
    await prisma.sequenceEnrollment.updateMany({
      where: { sequenceId: existing.id, status: "ACTIVE" },
      data: { status: "STOPPED", stoppedReason: "SEQUENCE_ARCHIVED", nextStepAt: null, completedAt: new Date() },
    });
  }

  await writeAudit(ctx, {
    action: "sequence.status_changed",
    entityType: "Sequence",
    entityId: sequence.id,
    before: { status: existing.status },
    after: { status: sequence.status },
  });

  return getSequence(ctx, sequence.id);
}
