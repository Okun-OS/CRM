import "server-only";
import { z } from "zod";
import type { ActivityDirection, CrmEventType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { liveScope, scope } from "@/lib/tenant";
import { MAILWIN_SIGNALS, MAILWIN_SIGNAL_LABELS, type MailwinSignal, type MailwinStageSignal } from "@/lib/crm/mailwin";
import { formatCurrency } from "@/lib/format";
import { changeDealStage } from "@/server/services/deals";
import { createMeeting } from "@/server/services/meetings";
import { pauseRecordAutomation, setManualNextAction } from "@/server/services/next-actions";
import { createSuggestion } from "@/server/services/suggestions";
import { notFound } from "./errors";
import { isoDateTime, linkUrl, occurredAt } from "./schemas";
import { leadUrl, MAILWIN_SOURCE, withLock } from "./service";
import { loadSignalConfig, targetStageFor, type SignalConfig } from "./signal-settings";

/**
 * Signale zu einem Lead (POST /leads/{id}/signals).
 *
 * Mailwin meldet, *was es erkannt hat* („Angebot verschickt“, „Kunde nimmt
 * an“); das CRM entscheidet nach den Einstellungen des Arbeitsbereichs, *was
 * daraus folgt*. Feste Regeln:
 *
 * - Nur vorwärts: Ein Signal verschiebt nie zurück und öffnet nie einen
 *   gewonnenen oder verlorenen Lead wieder.
 * - Gewonnen/Verloren standardmäßig nur als Vorschlag — eine falsch erkannte
 *   Zusage darf keinen Umsatz in den Forecast schreiben.
 * - Alles steht „über Mailwin“ in der Zeitleiste, mit Zitat und Link.
 * - Idempotent über `signal` + `externalId`.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : undefined));

export const signalInputSchema = z.object({
  signal: z.enum(MAILWIN_SIGNALS, { error: `signal muss einer der folgenden Werte sein: ${MAILWIN_SIGNALS.join(", ")}.` }),
  occurredAt,
  externalId: z.string({ error: "externalId ist erforderlich." }).trim().min(1).max(200),
  url: linkUrl.optional(),
  summary: optionalText(2000),
  evidence: z
    .object({
      // Wörtlich aus der Nachricht, nie mehr als das Zitat.
      quote: optionalText(300),
      confidence: z.number().min(0, "confidence liegt zwischen 0 und 1.").max(1, "confidence liegt zwischen 0 und 1.").optional(),
    })
    .optional(),
  data: z
    .object({
      valueCents: z.number().int().min(0).max(100_000_000_000_000).optional(),
      offerNumber: optionalText(100),
      validUntil: optionalText(40),
      startAt: isoDateTime.optional(),
      endAt: isoDateTime.optional(),
      title: optionalText(200),
      location: optionalText(200),
      until: isoDateTime.optional(),
      reason: optionalText(500),
    })
    .optional(),
});

export type SignalInput = z.infer<typeof signalInputSchema>;

export type SignalOutcome = {
  signal: MailwinSignal;
  duplicate: boolean;
  /** Was das CRM ausgeführt hat. */
  applied: string[];
  /** Was ein Mensch noch bestätigen muss. */
  proposed: { id: string; kind: string; title: string }[];
  /** Was bewusst nicht geschah, mit Grund. */
  ignored: string[];
  lead: LeadState;
};

type LeadState = {
  id: string;
  url: string;
  status: "open" | "won" | "lost";
  stage: { id: string; name: string };
  valueCents: number;
  nextAction: { type: string; title: string; dueAt: string | null } | null;
  operationalState: string;
};

const SIGNAL_SOURCE = "mailwin:signal";

const DIRECTION: Record<MailwinSignal, ActivityDirection> = {
  offer_sent: "OUTBOUND",
  contract_sent: "OUTBOUND",
  offer_accepted: "INBOUND",
  offer_declined: "INBOUND",
  meeting_requested: "INBOUND",
  meeting_booked: "INBOUND",
  question: "INBOUND",
  out_of_office: "INBOUND",
  contract_accepted: "INBOUND",
};

/** Engine-Ereignis je Signal. Eine Abwesenheitsnotiz ist ausdrücklich keine Kundenantwort. */
const ENGINE_EVENT: Partial<Record<MailwinSignal, CrmEventType>> = {
  offer_sent: "OFFER_SENT",
  contract_sent: "CONTRACT_SENT",
  contract_accepted: "CONTRACT_ACCEPTED",
  offer_accepted: "CUSTOMER_REPLIED",
  offer_declined: "CUSTOMER_REPLIED",
  meeting_requested: "CUSTOMER_REPLIED",
  question: "CUSTOMER_REPLIED",
};

export async function processSignal(ctx: ActorContext, leadId: string, input: SignalInput): Promise<SignalOutcome> {
  assertPermission(ctx, "deals.write");

  return withLock(`mailwin:signal:${ctx.organizationId}:${leadId}`, async () => {
    const deal = await prisma.deal.findFirst({
      where: { id: leadId, ...liveScope(ctx) },
      include: {
        stage: true,
        pipeline: { include: { stages: { orderBy: { position: "asc" } } } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { contactId: true }, take: 1 },
      },
    });
    if (!deal) throw notFound("Der Lead wurde nicht gefunden.");

    const externalId = `${input.signal}:${input.externalId}`;
    const previous = await prisma.activity.findUnique({
      where: {
        organizationId_externalSource_externalId: { organizationId: ctx.organizationId, externalSource: SIGNAL_SOURCE, externalId },
      },
      select: { metadata: true },
    });
    if (previous) {
      const stored = (previous.metadata as { outcome?: Omit<SignalOutcome, "lead" | "duplicate"> } | null)?.outcome;
      return {
        signal: input.signal,
        duplicate: true,
        applied: stored?.applied ?? [],
        proposed: stored?.proposed ?? [],
        ignored: stored?.ignored ?? [],
        lead: await leadState(ctx, deal.id),
      };
    }

    const contactId = deal.contacts[0]?.contactId ?? null;
    const links = { dealId: deal.id, contactId, companyId: deal.companyId };
    const outcome = { applied: [] as string[], proposed: [] as SignalOutcome["proposed"], ignored: [] as string[] };

    // Zuerst die Zeitleiste — damit der Beleg steht, auch wenn eine Folge scheitert.
    const label = MAILWIN_SIGNAL_LABELS[input.signal];
    const quote = input.evidence?.quote;
    const activity = await prisma.activity.create({
      data: {
        organizationId: ctx.organizationId,
        type: "SYSTEM",
        source: "MAILWIN",
        subject: `${label} (erkannt von Mailwin)`,
        body: [input.summary, quote ? `„${quote}“` : null].filter(Boolean).join("\n\n") || null,
        direction: DIRECTION[input.signal],
        occurredAt: input.occurredAt,
        actorId: null,
        externalSource: SIGNAL_SOURCE,
        externalId,
        metadata: { source: MAILWIN_SOURCE, signal: input.signal, url: input.url ?? null, evidence: input.evidence ?? null, data: input.data ?? null },
        ...links,
      },
      select: { id: true },
    });
    outcome.applied.push("timeline");

    const closed = deal.status !== "OPEN";
    if (closed) {
      outcome.ignored.push(`lead_closed: Der Lead ist bereits ${deal.status === "WON" ? "gewonnen" : "verloren"}, es wurde nur protokolliert.`);
    } else {
      const config = await loadSignalConfig(ctx.organizationId);
      // Erst die Folgen (Phase, Termin, Vorschlag), dann das Engine-Ereignis:
      // So rechnet das aktive CRM die nächste Aktion schon auf dem neuen Stand.
      await applySignal(ctx, deal, input, config, contactId, outcome);
      await reportToEngine(ctx, input, links, externalId);
    }

    await prisma.activity.update({
      where: { id: activity.id },
      data: {
        metadata: {
          source: MAILWIN_SOURCE,
          signal: input.signal,
          url: input.url ?? null,
          evidence: input.evidence ?? null,
          data: input.data ?? null,
          outcome,
        },
      },
    });

    return { signal: input.signal, duplicate: false, ...outcome, lead: await leadState(ctx, deal.id) };
  });
}

type DealWithStages = {
  id: string;
  name: string;
  amount: unknown;
  currency: string;
  ownerId: string | null;
  pipelineId: string;
  stage: { id: string; name: string; position: number };
  pipeline: { stages: { id: string; key: string; name: string; type: string; position: number }[] };
};

async function applySignal(
  ctx: ActorContext,
  deal: DealWithStages,
  input: SignalInput,
  config: SignalConfig,
  contactId: string | null,
  outcome: { applied: string[]; proposed: SignalOutcome["proposed"]; ignored: string[] },
) {
  const ref = { kind: "DEAL" as const, id: deal.id };
  const reason = input.summary ?? input.evidence?.quote ?? MAILWIN_SIGNAL_LABELS[input.signal];
  const confidence = input.evidence?.confidence;
  const quote = input.evidence?.quote;
  const evidence = { quote, confidence, url: input.url, signal: input.signal, externalId: input.externalId };
  // Automatisch abschließen nur mit Einstellung, ausreichender Verlässlichkeit
  // und einem wörtlichen Zitat als Beleg.
  const autoClose = (setting: "suggest" | "auto") =>
    setting === "auto" && confidence !== undefined && confidence >= config.autoMinConfidence && Boolean(quote);
  const whyOnlySuggested = (setting: "suggest" | "auto") =>
    setting !== "auto"
      ? null
      : !quote
        ? "ohne wörtliches Zitat"
        : `Verlässlichkeit unter ${Math.round(config.autoMinConfidence * 100)} %`;

  switch (input.signal) {
    case "offer_sent": {
      await moveForward(ctx, deal, config, "offer_sent", outcome);
      // Der Wert wird nie still überschrieben: leer → übernehmen, abweichend
      // → Vorschlag (oder, je nach Einstellung, gar nichts).
      const valueCents = input.data?.valueCents;
      if (valueCents !== undefined && valueCents > 0) {
        const current = Math.round(Number(deal.amount) * 100);
        if (current === valueCents) {
          // nichts zu tun
        } else if (current === 0) {
          await prisma.deal.update({ where: { id: deal.id }, data: { amount: valueCents / 100 } });
          outcome.applied.push("value_updated");
        } else if (config.offerValue === "suggest") {
          const amount = formatCurrency(valueCents / 100, deal.currency);
          // Derselbe Betrag aus einem zweiten Angebot legt keinen zweiten Vorschlag an.
          const pending = await prisma.recordSuggestion.findMany({
            where: { ...scope(ctx), dealId: deal.id, kind: "deal.update_value", status: "PENDING" },
            select: { id: true, kind: true, title: true, payload: true },
          });
          const same = pending.find((row) => (row.payload as { valueCents?: number } | null)?.valueCents === valueCents);
          const suggestion = same ?? await createSuggestion(ctx, {
            source: MAILWIN_SOURCE,
            kind: "deal.update_value",
            dealId: deal.id,
            title: `Wert auf ${amount} aktualisieren?`,
            reason: `Im versendeten Angebot steht ${amount}, am Deal ${formatCurrency(current / 100, deal.currency)} (erkannt von Mailwin).`,
            payload: { valueCents, previousValueCents: current },
            evidence,
          });
          outcome.proposed.push({ id: suggestion.id, kind: suggestion.kind, title: suggestion.title });
        } else {
          outcome.ignored.push("value: Der Lead hat bereits einen Wert; laut Mailwin-Einstellungen werden nur leere Werte übernommen.");
        }
      }
      outcome.applied.push("offer_follow_up");
      return;
    }

    case "contract_sent":
      await moveForward(ctx, deal, config, "contract_sent", outcome);
      return;

    case "meeting_booked": {
      if (input.data?.startAt) {
        const startAt = input.data.startAt;
        const endAt = input.data.endAt && input.data.endAt > startAt ? input.data.endAt : new Date(startAt.getTime() + 60 * 60_000);
        await createMeeting(ctx, {
          title: input.data.title ?? `Termin: ${deal.name}`,
          startAt,
          endAt,
          location: input.data.location,
          dealId: deal.id,
          contactId: contactId ?? undefined,
          ownerId: deal.ownerId ?? undefined,
        });
        outcome.applied.push("meeting_created");
      } else {
        const { recordEvent } = await import("@/server/engine/events");
        await recordEvent(ctx, {
          type: "MEETING_BOOKED",
          source: "INTEGRATION",
          occurredAt: input.occurredAt,
          idempotencyKey: `mailwin:meeting:${input.externalId}`,
          suppressActivity: true,
          dealId: deal.id,
          contactId,
          payload: { title: input.data?.title ?? null },
        });
        outcome.ignored.push("meeting: Ohne data.startAt wurde kein Termin im Kalender angelegt.");
      }
      await moveForward(ctx, deal, config, "meeting_booked", outcome);
      return;
    }

    case "meeting_requested":
      await setManualNextAction(ctx, ref, {
        type: "SCHEDULE_MEETING",
        title: "Termin vereinbaren",
        reason: `Der Kunde wünscht einen Termin (erkannt von Mailwin): ${reason}`.slice(0, 500),
        dueAt: new Date(),
        ownerId: deal.ownerId ?? undefined,
      });
      outcome.applied.push("next_action_set");
      return;

    case "question":
      await setManualNextAction(ctx, ref, {
        type: "CUSTOM",
        title: "Rückfrage beantworten",
        reason: `Der Kunde hat eine Frage (erkannt von Mailwin): ${reason}`.slice(0, 500),
        dueAt: new Date(),
        ownerId: deal.ownerId ?? undefined,
      });
      outcome.applied.push("next_action_set");
      return;

    case "out_of_office": {
      const until = input.data?.until ?? new Date(input.occurredAt.getTime() + 7 * 24 * 60 * 60_000);
      if (until.getTime() <= Date.now()) {
        outcome.ignored.push("automation_pause: Das Rückkehrdatum liegt in der Vergangenheit.");
        return;
      }
      await pauseRecordAutomation(ctx, ref, {
        until,
        reason: input.data?.until
          ? "Abwesenheitsnotiz (erkannt von Mailwin)"
          : "Abwesenheitsnotiz ohne Rückkehrdatum (erkannt von Mailwin) — pausiert für 7 Tage",
      });
      outcome.applied.push("automation_paused");
      return;
    }

    case "offer_accepted":
    case "contract_accepted": {
      if (autoClose(config.acceptance)) {
        await closeDeal(ctx, deal, "WON", undefined, outcome);
      } else {
        const suggestion = await createSuggestion(ctx, {
          source: MAILWIN_SOURCE,
          kind: "deal.mark_won",
          dealId: deal.id,
          title: "Als gewonnen markieren?",
          reason: `${input.signal === "offer_accepted" ? "Der Kunde hat das Angebot angenommen" : "Der Kunde hat den Vertrag angenommen"} (erkannt von Mailwin${confidence !== undefined ? `, Verlässlichkeit ${Math.round(confidence * 100)} %` : ""}).`,
          payload: {},
          evidence,
        });
        outcome.proposed.push({ id: suggestion.id, kind: suggestion.kind, title: suggestion.title });
        const why = whyOnlySuggested(config.acceptance);
        if (why) outcome.ignored.push(`won: ${why} — deshalb nur ein Vorschlag.`);
      }
      return;
    }

    case "offer_declined": {
      const lostReason = input.data?.reason ?? input.summary ?? "Angebot abgelehnt (erkannt von Mailwin)";
      if (autoClose(config.decline)) {
        await closeDeal(ctx, deal, "LOST", lostReason, outcome);
      } else {
        const suggestion = await createSuggestion(ctx, {
          source: MAILWIN_SOURCE,
          kind: "deal.mark_lost",
          dealId: deal.id,
          title: "Als verloren markieren?",
          reason: `Der Kunde hat abgesagt (erkannt von Mailwin): ${lostReason}`.slice(0, 500),
          payload: { lostReason: lostReason.slice(0, 500) },
          evidence,
        });
        outcome.proposed.push({ id: suggestion.id, kind: suggestion.kind, title: suggestion.title });
        const why = whyOnlySuggested(config.decline);
        if (why) outcome.ignored.push(`lost: ${why} — deshalb nur ein Vorschlag.`);
      }
      return;
    }
  }
}

/** Rückt in die zugeordnete Phase vor — nie zurück, nie in eine geschlossene Phase. */
async function moveForward(
  ctx: ActorContext,
  deal: DealWithStages,
  config: SignalConfig,
  signal: MailwinStageSignal,
  outcome: { applied: string[]; ignored: string[] },
) {
  const target = targetStageFor(config, deal.pipelineId, deal.pipeline.stages, signal);
  if (!target) {
    outcome.ignored.push("stage: Für dieses Signal ist in dieser Pipeline keine Phase zugeordnet.");
    return;
  }
  if (target.position <= deal.stage.position) {
    outcome.ignored.push(`stage: Der Lead steht schon in „${deal.stage.name}“ — Phasen gehen nur vorwärts.`);
    return;
  }
  await changeDealStage(ctx, deal.id, { stageId: target.id });
  outcome.applied.push(`stage_changed:${target.name}`);
}

async function closeDeal(
  ctx: ActorContext,
  deal: DealWithStages,
  type: "WON" | "LOST",
  lostReason: string | undefined,
  outcome: { applied: string[]; ignored: string[] },
) {
  const stage = deal.pipeline.stages.find((candidate) => candidate.type === type);
  if (!stage) {
    outcome.ignored.push(`${type === "WON" ? "won" : "lost"}: Die Pipeline hat keine passende Phase.`);
    return;
  }
  await changeDealStage(ctx, deal.id, { stageId: stage.id, lostReason });
  outcome.applied.push(type === "WON" ? "won" : "lost");
}

async function reportToEngine(
  ctx: ActorContext,
  input: SignalInput,
  links: { dealId: string; contactId: string | null; companyId: string | null },
  externalId: string,
) {
  const type = ENGINE_EVENT[input.signal];
  if (!type) return;
  const { recordEvent } = await import("@/server/engine/events");
  await recordEvent(ctx, {
    type,
    source: "INTEGRATION",
    occurredAt: input.occurredAt,
    idempotencyKey: `mailwin:${externalId}`,
    suppressActivity: true,
    dealId: links.dealId,
    contactId: links.contactId,
    companyId: links.companyId,
    payload: {
      reference: input.data?.offerNumber ?? null,
      subject: input.summary ?? null,
      signal: input.signal,
    },
  });
}

async function leadState(ctx: ActorContext, dealId: string): Promise<LeadState> {
  const deal = await prisma.deal.findFirstOrThrow({
    where: { id: dealId, ...scope(ctx) },
    select: {
      id: true,
      status: true,
      amount: true,
      operationalState: true,
      nextActionTitle: true,
      nextActionAt: true,
      nextActionType: true,
      stage: { select: { id: true, name: true } },
    },
  });
  return {
    id: deal.id,
    url: leadUrl(deal.id),
    status: deal.status.toLowerCase() as LeadState["status"],
    stage: deal.stage,
    valueCents: Math.round(Number(deal.amount) * 100),
    nextAction: deal.nextActionTitle
      ? {
          type: (deal.nextActionType ?? "CUSTOM").toLowerCase(),
          title: deal.nextActionTitle,
          dueAt: deal.nextActionAt?.toISOString() ?? null,
        }
      : null,
    operationalState: deal.operationalState.toLowerCase(),
  };
}
