import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { notify } from "@/server/services/notifications";
import { addSuppression } from "./suppression";
import { stopEnrollmentInternal } from "./enrollment";
import { intelligenceProvider } from "@/server/acquisition/providers/registry";
import type { ReplyClassification } from "@/generated/prisma/enums";

/**
 * Eingehende Antworten.
 *
 * Der Punkt, an dem aus Versand ein Gespräch wird. Zwei Regeln bestimmen den
 * Entwurf:
 *
 * **Eine Antwort darf nie verschwinden.** Die Einstufung sortiert, sie
 * filtert nicht. Alles bleibt sichtbar, auch „Abwesend" und „Unklar".
 *
 * **Bei Unsicherheit entscheidet ein Mensch.** Solange keine
 * Intelligence-Schicht angebunden ist, stuft eine Regel nach Schlüsselwörtern
 * ein — und sagt das mit einer niedrigen Verlässlichkeit. Was unsicher ist,
 * landet in der Prüfliste statt in einer Automatik.
 */

/**
 * Regelbasierte Einstufung.
 *
 * Bewusst konservativ: Sie meldet lieber `UNKNOWN`, als eine Antwort falsch
 * einzusortieren. Eine falsch als „Kein Interesse" abgelegte Antwort kostet
 * ein Geschäft; eine als „Unklar" markierte kostet dreißig Sekunden.
 */
export function classifyByRules(subject: string, body: string): { classification: ReplyClassification; confidence: number } {
  const text = `${subject}\n${body}`.toLowerCase();

  const has = (...needles: string[]) => needles.some((needle) => text.includes(needle));

  if (has("abwesenheit", "out of office", "bin im urlaub", "nicht im haus", "automatische antwort", "auto-reply")) {
    return { classification: "OUT_OF_OFFICE", confidence: 85 };
  }
  if (has("abmelden", "unsubscribe", "austragen", "keine weiteren e-mails", "keine weiteren mails", "newsletter abbestellen")) {
    return { classification: "UNSUBSCRIBE", confidence: 85 };
  }
  if (has("kein interesse", "kein bedarf", "nicht interessiert", "bitte keine", "absage")) {
    return { classification: "NOT_INTERESTED", confidence: 70 };
  }
  if (has("termin", "meeting", "gespräch vereinbaren", "calendly", "wann hätten sie zeit", "telefonat vereinbaren")) {
    return { classification: "MEETING_REQUEST", confidence: 65 };
  }
  if (has("kollege", "kollegin", "zuständig ist", "wenden sie sich an", "leite ich weiter")) {
    return { classification: "REFERRAL", confidence: 60 };
  }
  if (has("später", "nächstes quartal", "melden sie sich", "im neuen jahr", "derzeit nicht", "zurzeit nicht")) {
    return { classification: "LATER", confidence: 60 };
  }
  if (has("interessant", "gerne mehr", "schicken sie", "unterlagen", "mehr erfahren", "klingt gut")) {
    return { classification: "INTERESTED", confidence: 55 };
  }
  if (text.includes("?")) {
    return { classification: "QUESTION", confidence: 45 };
  }

  // Keine Regel greift. Das ist kein Makel, sondern die ehrliche Auskunft,
  // dass hier jemand draufschauen sollte.
  return { classification: "UNKNOWN", confidence: 0 };
}

export const replyInputSchema = z.object({
  /** Zuordnung über die Einschreibung oder direkt über den Prospect. */
  enrollmentId: z.string().max(30).optional(),
  prospectId: z.string().max(30).optional(),
  fromAddress: z.string().trim().max(254),
  subject: z.string().trim().max(500).default(""),
  body: z.string().max(100_000).default(""),
  receivedAt: z.coerce.date().optional(),
  providerMessageId: z.string().max(200).optional(),
});

/**
 * Nimmt eine eingegangene Antwort entgegen und zieht die Folgen.
 *
 * Aufrufbar aus einem Postfachabgleich, einem Webhook oder von Hand. Die
 * Reaktionen hängen an der Einstufung, nicht am Kanal.
 */
export async function recordReply(ctx: ActorContext, input: z.input<typeof replyInputSchema>) {
  assertPermission(ctx, "outreach.replies");
  const data = replyInputSchema.parse(input);
  const now = data.receivedAt ?? new Date();

  const enrollment = data.enrollmentId
    ? await prisma.sequenceEnrollment.findFirst({
        where: { id: data.enrollmentId, ...scope(ctx) },
        include: { prospect: true, sequence: true },
      })
    : data.prospectId
      ? await prisma.sequenceEnrollment.findFirst({
          where: { prospectId: data.prospectId, ...scope(ctx), status: "ACTIVE" },
          include: { prospect: true, sequence: true },
          orderBy: { startedAt: "desc" },
        })
      : null;

  const prospect =
    enrollment?.prospect ??
    (data.prospectId
      ? await prisma.prospect.findFirst({ where: { id: data.prospectId, ...scope(ctx) } })
      : await prisma.prospect.findFirst({
          where: { ...scope(ctx), deletedAt: null, email: data.fromAddress.toLowerCase() },
        }));

  if (!prospect) {
    throw new Error("Zu dieser Antwort wurde kein Prospect gefunden.");
  }

  /* ── Einstufen ──────────────────────────────────────────────────────── */
  const provider = intelligenceProvider();
  let classification: ReplyClassification;
  let confidence: number;

  if (provider?.classifyReply && (await provider.available(ctx))) {
    const judged = await provider.classifyReply(ctx, { subject: data.subject, body: data.body });
    classification = judged.classification as ReplyClassification;
    confidence = judged.confidence;
  } else {
    const judged = classifyByRules(data.subject, data.body);
    classification = judged.classification;
    confidence = judged.confidence;
  }

  const message = await prisma.emailMessage.create({
    data: {
      organizationId: ctx.organizationId,
      direction: "INBOUND",
      status: "SENT",
      subject: data.subject || "(ohne Betreff)",
      bodyHtml: data.body,
      fromAddress: data.fromAddress,
      toAddresses: [],
      ccAddresses: [],
      bccAddresses: [],
      prospectId: prospect.id,
      enrollmentId: enrollment?.id ?? null,
      threadKey: enrollment?.id ?? null,
      providerMessageId: data.providerMessageId ?? null,
      sentAt: now,
      replyClassification: classification,
      replyConfidence: confidence,
    },
  });

  await emitDomainEvent(ctx, {
    name: "outreach.reply_received",
    entityType: "PROSPECT",
    entityId: prospect.id,
    payload: { messageId: message.id, classification, confidence },
  });

  await applyReplyConsequences(ctx, {
    prospectId: prospect.id,
    prospectEmail: prospect.email,
    prospectName: prospect.companyName,
    ownerId: prospect.ownerId,
    enrollmentId: enrollment?.id ?? null,
    sequenceName: enrollment?.sequence.name ?? null,
    stopOnReply: enrollment?.sequence.stopOnReply ?? true,
    stopOnMeeting: enrollment?.sequence.stopOnMeeting ?? true,
    classification,
    confidence,
    messageId: message.id,
  });

  return { messageId: message.id, classification, confidence, prospectId: prospect.id };
}

type Consequences = {
  prospectId: string;
  prospectEmail: string | null;
  prospectName: string;
  ownerId: string | null;
  enrollmentId: string | null;
  sequenceName: string | null;
  stopOnReply: boolean;
  stopOnMeeting: boolean;
  classification: ReplyClassification;
  confidence: number;
  messageId: string;
};

/**
 * Was aus einer Antwort folgt.
 *
 * Eine Abwesenheitsnotiz ist ausdrücklich **kein** Grund, die Sequenz zu
 * beenden — das ist der häufigste Fehler solcher Systeme und kostet jedes Mal
 * ein Geschäft.
 */
async function applyReplyConsequences(ctx: ActorContext, input: Consequences) {
  const now = new Date();

  if (input.classification === "OUT_OF_OFFICE") {
    // Nichts anhalten, nichts umstufen — nur festhalten, dass es ankam.
    return;
  }

  if (input.classification === "UNSUBSCRIBE") {
    if (input.prospectEmail) {
      await addSuppression(
        ctx,
        { scope: "EMAIL", value: input.prospectEmail, reason: "UNSUBSCRIBED", note: "Abmeldung per Antwort" },
        { permission: false },
      );
    }
    await prisma.prospect.update({
      where: { id: input.prospectId },
      data: { stage: "DO_NOT_CONTACT", repliedAt: now },
    });
    if (input.enrollmentId) {
      await stopEnrollmentInternal(ctx, input.enrollmentId, "UNSUBSCRIBED", "Abmeldung per Antwort");
    }
    await emitDomainEvent(ctx, {
      name: "prospect.unsubscribed",
      entityType: "PROSPECT",
      entityId: input.prospectId,
      payload: { messageId: input.messageId },
    });
    return;
  }

  /* ── Jede echte Antwort hält die Sequenz an ──────────────────────────── */
  const stage =
    input.classification === "INTERESTED"
      ? "INTERESTED"
      : input.classification === "MEETING_REQUEST"
        ? "REPLIED"
        : input.classification === "NOT_INTERESTED"
          ? "NOT_INTERESTED"
          : "REPLIED";

  await prisma.prospect.update({
    where: { id: input.prospectId },
    data: {
      stage,
      repliedAt: now,
      interestedAt: stage === "INTERESTED" ? now : undefined,
    },
  });

  if (input.enrollmentId && input.stopOnReply) {
    await stopEnrollmentInternal(ctx, input.enrollmentId, "REPLIED", `Antwort: ${input.classification}`);
  }

  await emitDomainEvent(ctx, {
    name: "prospect.replied",
    entityType: "PROSPECT",
    entityId: input.prospectId,
    payload: { classification: input.classification, confidence: input.confidence },
  });

  if (stage === "INTERESTED") {
    await emitDomainEvent(ctx, {
      name: "prospect.interested",
      entityType: "PROSPECT",
      entityId: input.prospectId,
      payload: { messageId: input.messageId },
    });
  }

  /* ── Menschen benachrichtigen, wo eine Entscheidung ansteht ──────────── */
  const worthTelling: ReplyClassification[] = ["INTERESTED", "MEETING_REQUEST", "QUESTION", "REFERRAL", "UNKNOWN"];
  if (input.ownerId && worthTelling.includes(input.classification)) {
    const LABEL: Partial<Record<ReplyClassification, string>> = {
      INTERESTED: "Interessierte Antwort",
      MEETING_REQUEST: "Terminwunsch",
      QUESTION: "Rückfrage",
      REFERRAL: "Verweis auf jemand anderen",
      UNKNOWN: "Antwort — Einstufung unklar",
    };
    await notify(ctx, {
      userId: input.ownerId,
      type: "REPLY_RECEIVED",
      title: `${LABEL[input.classification]}: ${input.prospectName}`,
      body:
        input.confidence < 50
          ? "Die Einstufung ist unsicher. Bitte kurz selbst ansehen."
          : `Aus der Sequenz „${input.sequenceName ?? "—"}".`,
    });
  }
}

/** Antworten, bei denen ein Mensch draufschauen sollte. */
export async function listRepliesForReview(ctx: ActorContext, options: { onlyOpen?: boolean } = {}) {
  assertPermission(ctx, "outreach.replies");
  const rows = await prisma.emailMessage.findMany({
    where: {
      ...scope(ctx),
      direction: "INBOUND",
      NOT: { prospectId: null },
      ...(options.onlyOpen ? { reviewedAt: null } : {}),
    },
    orderBy: { sentAt: "desc" },
    take: 200,
    include: {
      prospect: { select: { id: true, companyName: true, email: true, stage: true, ownerId: true } },
      enrollment: { select: { id: true, sequence: { select: { id: true, name: true } } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    body: row.bodyHtml,
    fromAddress: row.fromAddress,
    classification: row.replyClassification,
    confidence: row.replyConfidence,
    /// Ob die Einstufung verlässlich genug ist, um sich darauf zu verlassen.
    needsReview: row.reviewedAt === null && (row.replyConfidence ?? 0) < 60,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    prospect: row.prospect,
    sequence: row.enrollment?.sequence ?? null,
    receivedAt: row.sentAt?.toISOString() ?? row.createdAt.toISOString(),
  }));
}

export const reclassifySchema = z.object({
  classification: z.enum([
    "INTERESTED",
    "QUESTION",
    "MEETING_REQUEST",
    "LATER",
    "REFERRAL",
    "NOT_INTERESTED",
    "OUT_OF_OFFICE",
    "UNSUBSCRIBE",
    "UNKNOWN",
  ]),
});

/**
 * Einstufung von Hand korrigieren.
 *
 * Die Folgen werden dabei erneut gezogen: Wer eine als „unklar" abgelegte
 * Antwort auf „Abmeldung" setzt, erwartet zu Recht, dass die Sperre dann auch
 * wirklich greift.
 */
export async function reclassifyReply(ctx: ActorContext, messageId: string, input: z.input<typeof reclassifySchema>) {
  assertPermission(ctx, "outreach.replies");
  const data = reclassifySchema.parse(input);

  const message = assertFound(
    await prisma.emailMessage.findFirst({
      where: { id: messageId, ...scope(ctx), direction: "INBOUND" },
      include: {
        prospect: true,
        enrollment: { include: { sequence: { select: { name: true, stopOnReply: true, stopOnMeeting: true } } } },
      },
    }),
    "Die Nachricht wurde nicht gefunden.",
  );

  const before = message.replyClassification;
  await prisma.emailMessage.update({
    where: { id: message.id },
    data: {
      replyClassification: data.classification,
      // Von Hand eingestuft heißt: verlässlich. Deshalb keine Restzweifel.
      replyConfidence: 100,
      reviewedAt: new Date(),
      reviewedById: ctx.userId,
    },
  });

  if (message.prospect && before !== data.classification) {
    await applyReplyConsequences(ctx, {
      prospectId: message.prospect.id,
      prospectEmail: message.prospect.email,
      prospectName: message.prospect.companyName,
      ownerId: message.prospect.ownerId,
      enrollmentId: message.enrollmentId,
      sequenceName: message.enrollment?.sequence.name ?? null,
      stopOnReply: message.enrollment?.sequence.stopOnReply ?? true,
      stopOnMeeting: message.enrollment?.sequence.stopOnMeeting ?? true,
      classification: data.classification,
      confidence: 100,
      messageId: message.id,
    });
  }

  await writeAudit(ctx, {
    action: "reply.reclassified",
    entityType: "EmailMessage",
    entityId: message.id,
    before: { classification: before },
    after: { classification: data.classification },
  });

  await emitDomainEvent(ctx, {
    name: "outreach.reply_classified",
    entityType: "PROSPECT",
    entityId: message.prospectId ?? message.id,
    payload: { classification: data.classification, byHand: true },
  });

  return { id: message.id, classification: data.classification };
}

/** Markiert eine Antwort als gesichtet, ohne die Einstufung zu ändern. */
export async function markReplyReviewed(ctx: ActorContext, messageId: string) {
  assertPermission(ctx, "outreach.replies");
  const message = assertFound(
    await prisma.emailMessage.findFirst({ where: { id: messageId, ...scope(ctx), direction: "INBOUND" } }),
    "Die Nachricht wurde nicht gefunden.",
  );
  await prisma.emailMessage.update({
    where: { id: message.id },
    data: { reviewedAt: new Date(), reviewedById: ctx.userId },
  });
}

/**
 * Eine unzustellbare Nachricht.
 *
 * Bounce heißt: Diese Adresse führt zu nichts. Weiter zu senden schadet der
 * Zustellbarkeit aller anderen Nachrichten — deshalb sofort sperren.
 */
export async function recordBounce(ctx: ActorContext, messageId: string, reason: string) {
  assertPermission(ctx, "outreach.replies");
  const message = assertFound(
    await prisma.emailMessage.findFirst({
      where: { id: messageId, ...scope(ctx) },
      include: { prospect: true },
    }),
    "Die Nachricht wurde nicht gefunden.",
  );

  await prisma.emailMessage.update({
    where: { id: message.id },
    data: { status: "BOUNCED", bouncedAt: new Date(), bounceReason: reason.slice(0, 300) },
  });

  const address = message.toAddresses[0];
  if (address) {
    await addSuppression(
      ctx,
      { scope: "EMAIL", value: address, reason: "BOUNCED", note: reason.slice(0, 300) },
      { permission: false },
    );
  }

  if (message.enrollmentId) {
    await stopEnrollmentInternal(ctx, message.enrollmentId, "BOUNCED", reason.slice(0, 300));
  }

  await emitDomainEvent(ctx, {
    name: "outreach.email_bounced",
    entityType: "PROSPECT",
    entityId: message.prospectId ?? message.id,
    payload: { messageId: message.id, reason },
  });

  return { id: message.id, suppressed: Boolean(address) };
}
