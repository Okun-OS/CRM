import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { ValidationError } from "@/lib/api/errors";
import { checkSuppression } from "./suppression";
import { membershipWhere } from "./lists";

/**
 * Einschreibung eines Prospects in eine Sequenz.
 *
 * Hier stehen die Schutzregeln, und sie stehen **serverseitig**: Ohne sie
 * wäre die Engine ein Werkzeug, mit dem man versehentlich dieselben Menschen
 * mehrfach anschreibt oder solche, die das ausdrücklich nicht wollen.
 *
 * Geprüft wird, ob
 * — eine Kontaktsperre vorliegt,
 * — überhaupt eine Adresse bekannt ist,
 * — die Stufe eine Ansprache erlaubt,
 * — der Prospect bereits in dieser Sequenz steckt,
 * — der Prospect schon in einer anderen Sequenz läuft.
 */
export const enrollInputSchema = z
  .object({
    sequenceId: z.string().min(1).max(30),
    prospectIds: z.array(z.string().max(30)).max(500).optional(),
    listId: z.string().max(30).optional(),
    /** Vorschau: nur prüfen, nichts einschreiben. */
    dryRun: z.boolean().default(false),
  })
  .refine((value) => Boolean(value.prospectIds?.length) || Boolean(value.listId), {
    message: "Geben Sie Prospects oder eine Liste an.",
    path: ["prospectIds"],
  });

export type EnrollmentRejection = {
  prospectId: string;
  companyName: string;
  reason: string;
};

export type EnrollmentResult = {
  enrolled: number;
  rejected: EnrollmentRejection[];
  /** Nur geprüft, nichts geschrieben. */
  dryRun: boolean;
};

const CONTACTABLE = new Set(["NEW", "RESEARCHING", "QUALIFIED", "READY"]);

export async function enrollProspects(
  ctx: ActorContext,
  input: z.input<typeof enrollInputSchema>,
): Promise<EnrollmentResult> {
  assertPermission(ctx, "outreach.enroll");
  const data = enrollInputSchema.parse(input);

  const sequence = assertFound(
    await prisma.sequence.findFirst({
      where: { id: data.sequenceId, ...scope(ctx), archivedAt: null },
      include: { steps: { orderBy: { position: "asc" }, take: 1 } },
    }),
    "Die Sequenz wurde nicht gefunden.",
  );

  if (sequence.status === "ARCHIVED") throw ValidationError("Diese Sequenz ist archiviert.");
  if (sequence.steps.length === 0) throw ValidationError("Diese Sequenz hat keine Schritte.");

  let prospects;
  if (data.listId) {
    const list = assertFound(
      await prisma.prospectList.findFirst({ where: { id: data.listId, ...scope(ctx) } }),
      "Die Liste wurde nicht gefunden.",
    );
    prospects = await prisma.prospect.findMany({
      where: { ...scope(ctx), deletedAt: null, ...membershipWhere(list) },
      take: 1000,
    });
  } else {
    prospects = await prisma.prospect.findMany({
      where: { id: { in: data.prospectIds ?? [] }, ...scope(ctx), deletedAt: null },
    });
  }

  const result: EnrollmentResult = { enrolled: 0, rejected: [], dryRun: data.dryRun };
  const firstStep = sequence.steps[0];
  const now = new Date();

  for (const prospect of prospects) {
    const reject = (reason: string) =>
      result.rejected.push({ prospectId: prospect.id, companyName: prospect.companyName, reason });

    // Die Reihenfolge ist Absicht: Es gewinnt die **genauere** Begründung.
    // „Läuft bereits in dieser Sequenz" sagt einem Menschen, was los ist;
    // „die Stufe erlaubt das nicht" wäre zwar auch wahr, aber die Folge
    // davon — und damit die unbrauchbarere Auskunft.
    if (!prospect.email) {
      reject("Keine E-Mail-Adresse hinterlegt.");
      continue;
    }

    const suppression = await checkSuppression(ctx.organizationId, prospect.email);
    if (suppression.blocked) {
      reject(suppression.reason);
      continue;
    }

    const already = await prisma.sequenceEnrollment.findUnique({
      where: { sequenceId_prospectId: { sequenceId: sequence.id, prospectId: prospect.id } },
    });
    if (already) {
      reject(
        already.status === "ACTIVE"
          ? "Läuft bereits in dieser Sequenz."
          : "War bereits in dieser Sequenz eingeschrieben.",
      );
      continue;
    }

    // Mehrere gleichzeitige Sequenzen wären aus Sicht des Empfängers eine
    // Belästigung — unabhängig davon, wie die Kampagnen intern heißen.
    const elsewhere = await prisma.sequenceEnrollment.findFirst({
      where: { organizationId: ctx.organizationId, prospectId: prospect.id, status: "ACTIVE" },
      include: { sequence: { select: { name: true } } },
    });
    if (elsewhere) {
      reject(`Läuft bereits in der Sequenz „${elsewhere.sequence.name}".`);
      continue;
    }

    if (!CONTACTABLE.has(prospect.stage)) {
      reject(`Die Stufe „${prospect.stage}" erlaubt keine neue Ansprache.`);
      continue;
    }

    if (data.dryRun) {
      result.enrolled += 1;
      continue;
    }

    const scheduledFor = new Date(
      now.getTime() + firstStep.delayDays * 86_400_000 + firstStep.delayHours * 3_600_000,
    );

    await prisma.$transaction(async (tx) => {
      const enrollment = await tx.sequenceEnrollment.create({
        data: {
          organizationId: ctx.organizationId,
          sequenceId: sequence.id,
          prospectId: prospect.id,
          listId: data.listId ?? null,
          enrolledById: ctx.userId,
          currentStep: 0,
          nextStepAt: scheduledFor,
        },
      });

      // Der erste Lauf wird sofort angelegt: Die Eindeutigkeit über
      // (Einschreibung, Schritt) ist der Schutz gegen doppelten Versand.
      await tx.enrollmentStepRun.create({
        data: {
          organizationId: ctx.organizationId,
          enrollmentId: enrollment.id,
          stepId: firstStep.id,
          scheduledFor,
        },
      });

      await tx.prospect.update({ where: { id: prospect.id }, data: { stage: "IN_SEQUENCE" } });
    });

    result.enrolled += 1;

    await emitDomainEvent(ctx, {
      name: "prospect.enrolled",
      entityType: "PROSPECT",
      entityId: prospect.id,
      payload: { sequenceId: sequence.id, sequenceName: sequence.name },
    });
  }

  if (!data.dryRun && result.enrolled > 0) {
    await writeAudit(ctx, {
      action: "sequence.enrolled",
      entityType: "Sequence",
      entityId: sequence.id,
      after: { enrolled: result.enrolled, rejected: result.rejected.length, listId: data.listId ?? null },
    });

    await emitDomainEvent(ctx, {
      name: "sequence.started",
      entityType: "SEQUENCE",
      entityId: sequence.id,
      payload: { enrolled: result.enrolled },
    });
  }

  return result;
}

export const stopReasons = [
  "REPLIED",
  "MEETING_BOOKED",
  "CONVERTED",
  "BOUNCED",
  "UNSUBSCRIBED",
  "SUPPRESSED",
  "MANUAL",
  "SEQUENCE_ARCHIVED",
  "FINISHED",
] as const;

/**
 * Beendet eine Einschreibung.
 *
 * Wird sowohl von Hand als auch von der Ereignisverarbeitung aufgerufen —
 * deshalb ohne Rechteprüfung im inneren Pfad. Offene Läufe werden mit
 * abgeräumt; ein wartender Schritt einer beendeten Sequenz wäre sonst eine
 * Nachricht, die später doch noch herausgeht.
 */
export async function stopEnrollmentInternal(
  ctx: ActorContext,
  enrollmentId: string,
  reason: (typeof stopReasons)[number],
  note?: string,
) {
  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollmentId, organizationId: ctx.organizationId },
    include: { sequence: { select: { id: true, name: true } } },
  });
  if (!enrollment || enrollment.status !== "ACTIVE") return null;

  await prisma.$transaction(async (tx) => {
    await tx.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: reason === "FINISHED" ? "COMPLETED" : "STOPPED",
        stoppedReason: reason,
        stoppedNote: note ?? null,
        nextStepAt: null,
        completedAt: new Date(),
      },
    });

    await tx.enrollmentStepRun.updateMany({
      where: { enrollmentId: enrollment.id, status: "PENDING" },
      data: { status: "SKIPPED", outcomeReason: `Einschreibung beendet: ${reason}` },
    });
  });

  await emitDomainEvent(ctx, {
    name: "sequence.stopped",
    entityType: "SEQUENCE",
    entityId: enrollment.sequence.id,
    payload: { enrollmentId: enrollment.id, prospectId: enrollment.prospectId, reason },
  });

  return enrollment;
}

export async function stopEnrollment(ctx: ActorContext, enrollmentId: string, note?: string) {
  assertPermission(ctx, "outreach.enroll");
  const stopped = await stopEnrollmentInternal(ctx, enrollmentId, "MANUAL", note);
  if (stopped) {
    await writeAudit(ctx, {
      action: "enrollment.stopped",
      entityType: "SequenceEnrollment",
      entityId: enrollmentId,
      after: { reason: "MANUAL", note: note ?? null },
    });
  }
  return stopped;
}

export async function listEnrollments(
  ctx: ActorContext,
  filter: { sequenceId?: string; prospectId?: string; status?: string } = {},
) {
  assertPermission(ctx, "outreach.sequences.read");
  const rows = await prisma.sequenceEnrollment.findMany({
    where: {
      ...scope(ctx),
      ...(filter.sequenceId ? { sequenceId: filter.sequenceId } : {}),
      ...(filter.prospectId ? { prospectId: filter.prospectId } : {}),
      ...(filter.status ? { status: filter.status as never } : {}),
    },
    include: {
      prospect: { select: { id: true, companyName: true, email: true, stage: true } },
      sequence: { select: { id: true, name: true } },
      _count: { select: { stepRuns: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 200,
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    currentStep: row.currentStep,
    nextStepAt: row.nextStepAt?.toISOString() ?? null,
    stoppedReason: row.stoppedReason,
    stoppedNote: row.stoppedNote,
    prospect: row.prospect,
    sequence: row.sequence,
    stepsRun: row._count.stepRuns,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  }));
}
