import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTestOrganization, defaultPipeline } from "./setup/factories";
import { createDeal, changeDealStage } from "@/server/services/deals";
import { createLead } from "@/server/services/leads";
import { createActivity } from "@/server/services/activities";
import { createContact } from "@/server/services/contacts";
import { reconcileSubject } from "@/server/engine/next-actions";
import { recordEvent } from "@/server/engine/events";
import { runSweepForOrganization } from "@/server/engine/sweep";
import { runDueAutomations } from "@/server/engine/automations";
import { evaluateRules } from "@/server/engine/rules";
import { computeMomentum } from "@/server/engine/momentum";
import { DEFAULT_THRESHOLDS } from "@/server/engine/settings";
import { nextSendingSlot } from "@/server/engine/guards";
import {
  completeNextAction,
  dismissNextAction,
  getActionCenter,
  getRecordActionState,
  pauseRecordAutomation,
  setManualNextAction,
  setRecall,
  snoozeNextAction,
} from "@/server/services/next-actions";
import { createApiKey, authenticateApiKey } from "@/server/services/api-keys";
import { ingestEvents } from "@/server/services/ingestion";
import type { EngineSubject } from "@/server/engine/types";
import type { ActorContext } from "@/lib/context";

const DAY = 24 * 60 * 60 * 1000;

async function newDeal(ctx: ActorContext, name = "Rahmenvertrag Nordwind") {
  const pipeline = await defaultPipeline(ctx);
  return createDeal(ctx, {
    name,
    pipelineId: pipeline.id,
    stageId: pipeline.stages[0].id,
    amount: 25_000,
  });
}

function subjectFixture(overrides: Partial<EngineSubject> = {}): EngineSubject {
  const now = new Date();
  return {
    kind: "DEAL",
    id: "deal-1",
    organizationId: "org-1",
    label: "Testdeal",
    ownerId: null,
    contactId: null,
    companyId: null,
    isOpen: true,
    createdAt: new Date(now.getTime() - 2 * DAY),
    stageEnteredAt: new Date(now.getTime() - 2 * DAY),
    lastActivityAt: new Date(now.getTime() - 1 * DAY),
    lastOutboundAt: null,
    lastCustomerResponseAt: null,
    nextMeetingAt: null,
    meetingCompletedAt: null,
    offerSentAt: null,
    expectedCloseDate: null,
    recallAt: null,
    stageName: "Erstkontakt",
    stageExpectedAction: null,
    stageExpectedActionDays: null,
    openTaskDueAt: null,
    openTaskCount: 0,
    manualAction: null,
    automationPausedUntil: null,
    ...overrides,
  };
}

describe("Regelkatalog", () => {
  const now = new Date();

  it("priorisiert die Kundenantwort vor jeder anderen Regel", () => {
    const subject = subjectFixture({
      lastOutboundAt: new Date(now.getTime() - 3 * DAY),
      lastCustomerResponseAt: new Date(now.getTime() - 1 * DAY),
      offerSentAt: new Date(now.getTime() - 10 * DAY),
    });
    const { proposal } = evaluateRules(subject, DEFAULT_THRESHOLDS, {}, now);

    expect(proposal.ruleKey).toBe("customer_replied.respond");
    expect(proposal.operationalState).toBe("WAITING_FOR_US");
    expect(proposal.reason).toContain("geantwortet");
  });

  it("setzt ein unbeantwortetes Angebot auf Warten auf Kunden", () => {
    const subject = subjectFixture({
      lastOutboundAt: new Date(now.getTime() - 6 * DAY),
      offerSentAt: new Date(now.getTime() - 6 * DAY),
    });
    const { proposal } = evaluateRules(subject, DEFAULT_THRESHOLDS, {}, now);

    expect(proposal.ruleKey).toBe("offer.chase");
    expect(proposal.type).toBe("CHASE_OFFER");
    expect(proposal.operationalState).toBe("WAITING_FOR_CUSTOMER");
  });

  it("lässt einen offenen Datensatz nie ohne nachvollziehbaren nächsten Schritt", () => {
    const subject = subjectFixture({ lastActivityAt: new Date(now.getTime() - 1 * DAY) });
    const { proposal } = evaluateRules(subject, DEFAULT_THRESHOLDS, {}, now);

    expect(proposal.ruleKey).toBe("fallback.define_next_step");
    expect(proposal.operationalState).toBe("NO_NEXT_ACTION");
    expect(proposal.reason.length).toBeGreaterThan(0);
  });

  it("berücksichtigt die von der Stage hinterlegte erwartete Aktion", () => {
    const subject = subjectFixture({ stageExpectedAction: "CREATE_OFFER", stageExpectedActionDays: 3 });
    const { proposal } = evaluateRules(subject, DEFAULT_THRESHOLDS, {}, now);

    expect(proposal.ruleKey).toBe("stage.expected_action");
    expect(proposal.type).toBe("CREATE_OFFER");
  });

  it("respektiert deaktivierte Regeln und Verzögerungs-Overrides", () => {
    const subject = subjectFixture({ lastOutboundAt: new Date(now.getTime() - 6 * DAY) });

    const disabled = evaluateRules(
      subject,
      DEFAULT_THRESHOLDS,
      { "outbound.follow_up": { isEnabled: false, delayDays: null, priority: null } },
      now,
    );
    expect(disabled.proposal.ruleKey).not.toBe("outbound.follow_up");
    expect(disabled.skipped).toContain("outbound.follow_up (deaktiviert)");

    const delayed = evaluateRules(
      subject,
      DEFAULT_THRESHOLDS,
      { "outbound.follow_up": { isEnabled: true, delayDays: 2, priority: 80 } },
      now,
    );
    expect(delayed.proposal.priority).toBe(80);
    expect(delayed.proposal.dueAt?.getTime()).toBe(
      (subject.lastOutboundAt as Date).getTime() + (DEFAULT_THRESHOLDS.followUpAfterDays + 2) * DAY,
    );
  });
});

describe("Momentum", () => {
  const now = new Date();

  it("begründet jeden Wert mit sichtbaren Signalen", () => {
    const result = computeMomentum(
      subjectFixture({
        lastCustomerResponseAt: new Date(now.getTime() - 1 * DAY),
        nextMeetingAt: new Date(now.getTime() + 3 * DAY),
        lastActivityAt: new Date(now.getTime() - 1 * DAY),
      }),
      DEFAULT_THRESHOLDS,
      now,
    );

    expect(result.momentum).toBe("HIGH");
    expect(result.signals.length).toBeGreaterThan(1);
    expect(result.signals.every((signal) => signal.label.length > 0)).toBe(true);
  });

  it("wertet fehlende Aktivität als Stagnation, unabhängig vom Punktestand", () => {
    const result = computeMomentum(
      subjectFixture({
        lastActivityAt: new Date(now.getTime() - 40 * DAY),
        nextMeetingAt: new Date(now.getTime() + 3 * DAY),
      }),
      DEFAULT_THRESHOLDS,
      now,
    );

    expect(result.momentum).toBe("STALLED");
    expect(result.signals.some((signal) => signal.label.includes("keine Aktivität"))).toBe(true);
  });
});

describe("Versandzeiten", () => {
  it("verschiebt Versand aus der Ruhezeit heraus", () => {
    const config = { ...DEFAULT_THRESHOLDS, workdaysOnly: false, quietHoursStart: 20, quietHoursEnd: 7 };
    const night = new Date("2026-03-04T22:30:00");
    const slot = nextSendingSlot(night, config);

    expect(slot.getTime()).toBeGreaterThan(night.getTime());
    expect(slot.getHours()).toBe(7);
  });
});

describe("Next-Action-Engine am realen Datensatz", () => {
  it("gibt jedem neuen Deal sofort einen nachvollziehbaren nächsten Schritt", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);

    const stored = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(stored.operationalState).not.toBe("CLOSED");
    expect(stored.nextActionTitle).not.toBeNull();

    const action = await prisma.nextAction.findFirst({ where: { dealId: deal.id, status: "OPEN" } });
    expect(action).not.toBeNull();
    expect(action?.reason.length).toBeGreaterThan(0);
  });

  it("ist idempotent: zweimal abgleichen erzeugt keine zweite Aktion", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);

    await reconcileSubject(ctx.organizationId, { kind: "DEAL", id: deal.id });
    await reconcileSubject(ctx.organizationId, { kind: "DEAL", id: deal.id });

    const open = await prisma.nextAction.count({ where: { dealId: deal.id, status: "OPEN" } });
    expect(open).toBe(1);
  });

  it("wechselt bei eingehender Antwort auf „Wir sind am Zug“", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);

    await createActivity(ctx, { type: "EMAIL", direction: "OUTBOUND", subject: "Angebotsübersicht", dealId: deal.id });
    let stored = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(stored.operationalState).toBe("WAITING_FOR_CUSTOMER");
    expect(stored.lastOutboundAt).not.toBeNull();

    await createActivity(ctx, { type: "EMAIL", direction: "INBOUND", subject: "Re: Angebotsübersicht", dealId: deal.id });
    stored = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(stored.operationalState).toBe("WAITING_FOR_US");
    expect(stored.lastCustomerResponseAt).not.toBeNull();
  });

  it("schließt beim Abschluss alles offene ab", async () => {
    const { ctx } = await createTestOrganization();
    const pipeline = await defaultPipeline(ctx);
    const deal = await newDeal(ctx);
    const won = pipeline.stages.find((stage) => stage.type === "WON");

    await changeDealStage(ctx, deal.id, { stageId: won?.id ?? pipeline.stages[0].id });

    const stored = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(stored.operationalState).toBe("CLOSED");
    expect(stored.nextActionTitle).toBeNull();

    const open = await prisma.nextAction.count({
      where: { dealId: deal.id, status: { in: ["OPEN", "SNOOZED"] } },
    });
    expect(open).toBe(0);
  });

  it("erkennt Stagnation und meldet sie dem Verantwortlichen", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);

    await prisma.deal.update({
      where: { id: deal.id },
      data: { lastActivityAt: new Date(Date.now() - 40 * DAY), createdAt: new Date(Date.now() - 45 * DAY) },
    });

    const result = await runSweepForOrganization(ctx.organizationId);
    expect(result.stalled).toBeGreaterThan(0);

    const stored = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(stored.momentum).toBe("STALLED");
    expect(stored.stalledSince).not.toBeNull();
    expect(stored.nextActionType).toBe("REACTIVATE");

    const notification = await prisma.notification.findFirst({
      where: { organizationId: ctx.organizationId, entityId: deal.id },
    });
    expect(notification?.title).toContain("Stagnation");
  });
});

describe("Ereignisse", () => {
  it("verarbeitet dieselbe Lieferung nur einmal", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);

    const first = await recordEvent(ctx, {
      type: "OFFER_SENT",
      idempotencyKey: "okun-deals-offer-4711",
      dealId: deal.id,
      payload: { reference: "AN-4711" },
    });
    const second = await recordEvent(ctx, {
      type: "OFFER_SENT",
      idempotencyKey: "okun-deals-offer-4711",
      dealId: deal.id,
      payload: { reference: "AN-4711" },
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);

    const events = await prisma.domainEventRecord.count({ where: { dealId: deal.id, type: "OFFER_SENT" } });
    expect(events).toBe(1);

    const activities = await prisma.activity.count({
      where: { dealId: deal.id, subject: { contains: "Angebot gesendet" } },
    });
    expect(activities).toBe(1);

    const stored = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(stored.offerSentAt).not.toBeNull();
    expect(stored.operationalState).toBe("WAITING_FOR_CUSTOMER");
  });

  it("schreibt die Timeline automatisch, ohne dass jemand etwas erfasst", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);

    await recordEvent(ctx, { type: "MEETING_BOOKED", dealId: deal.id, payload: { title: "Erstgespräch", startAt: new Date(Date.now() + 3 * DAY).toISOString() } });

    const activity = await prisma.activity.findFirst({
      where: { dealId: deal.id, type: "MEETING" },
      orderBy: { occurredAt: "desc" },
    });
    expect(activity?.subject).toContain("Erstgespräch");
    expect(activity?.source).toBe("SYSTEM");

    const stored = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(stored.nextMeetingAt).not.toBeNull();
    expect(stored.operationalState).toBe("SCHEDULED");
  });
});

describe("Automationen", () => {
  it("bricht geplante Follow-ups ab, sobald der Kunde antwortet", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);

    await createActivity(ctx, { type: "EMAIL", direction: "OUTBOUND", subject: "Angebot", dealId: deal.id });
    const pending = await prisma.scheduledAutomation.findFirst({ where: { dealId: deal.id, status: "PENDING" } });
    expect(pending).not.toBeNull();

    await createActivity(ctx, { type: "EMAIL", direction: "INBOUND", subject: "Re: Angebot", dealId: deal.id });

    const after = await prisma.scheduledAutomation.findUniqueOrThrow({ where: { id: pending?.id } });
    expect(after.status).toBe("CANCELLED");
    expect(after.outcomeReason).toContain("geantwortet");
  });

  it("prüft die Sicherheitsbedingungen erneut, unmittelbar vor der Ausführung", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);

    await createActivity(ctx, { type: "EMAIL", direction: "OUTBOUND", subject: "Angebot", dealId: deal.id });
    const pending = await prisma.scheduledAutomation.findFirstOrThrow({ where: { dealId: deal.id, status: "PENDING" } });

    // Fällig stellen, aber die Wirklichkeit ändert sich vorher: der Kunde antwortet,
    // ohne dass die Automation über den regulären Weg abgebrochen wurde.
    await prisma.scheduledAutomation.update({
      where: { id: pending.id },
      data: { scheduledFor: new Date(Date.now() - 60_000), status: "PENDING" },
    });
    await prisma.deal.update({ where: { id: deal.id }, data: { lastCustomerResponseAt: new Date() } });

    const outcomes = await runDueAutomations({ organizationId: ctx.organizationId });
    const outcome = outcomes.find((entry) => entry.id === pending.id);

    expect(outcome?.status).toBe("SKIPPED");
    expect(outcome?.reason).toContain("geantwortet");

    const tasks = await prisma.task.count({ where: { dealId: deal.id } });
    expect(tasks).toBe(0);
  });

  it("erstellt bei Fälligkeit eine Aufgabe für den Verantwortlichen", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);

    await createActivity(ctx, { type: "EMAIL", direction: "OUTBOUND", subject: "Angebot", dealId: deal.id });
    const pending = await prisma.scheduledAutomation.findFirstOrThrow({ where: { dealId: deal.id, status: "PENDING" } });
    await prisma.scheduledAutomation.update({
      where: { id: pending.id },
      data: {
        scheduledFor: new Date(Date.now() - 60_000),
        guards: [{ kind: "record_open" }, { kind: "automation_not_paused" }],
      },
    });

    const outcomes = await runDueAutomations({ organizationId: ctx.organizationId });
    expect(outcomes.find((entry) => entry.id === pending.id)?.status).toBe("EXECUTED");

    const task = await prisma.task.findFirst({ where: { dealId: deal.id } });
    expect(task?.title).toContain("Nachfassen");
    expect(task?.description).toContain("Antwort steht aus");
  });

  it("pausiert Automationen auf Wunsch, mit Begründung", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);
    const ref = { kind: "DEAL" as const, id: deal.id };

    await pauseRecordAutomation(ctx, ref, {
      until: new Date(Date.now() + 7 * DAY),
      reason: "Kunde ist im Urlaub.",
    });

    const stored = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(stored.automationPausedReason).toBe("Kunde ist im Urlaub.");

    const activity = await prisma.activity.findFirst({
      where: { dealId: deal.id, subject: { contains: "Automation pausiert" } },
    });
    expect(activity).not.toBeNull();
  });
});

describe("Action Center und manuelle Steuerung", () => {
  it("sortiert offene Aktionen in die Buckets des Vertriebstags", async () => {
    const { ctx } = await createTestOrganization();
    await newDeal(ctx, "Deal ohne nächsten Schritt");
    await createLead(ctx, { status: "new", firstName: "Jonas", lastName: "Berg", email: "jonas@example.test" });

    const center = await getActionCenter(ctx, { scope: "mine" });
    const buckets = Object.fromEntries(center.buckets.map((bucket) => [bucket.key, bucket.items.length]));

    expect(center.total).toBeGreaterThanOrEqual(2);
    expect(buckets.without_next_action).toBeGreaterThanOrEqual(1);
    expect(center.buckets.every((bucket) => bucket.items.every((item) => item.reason.length > 0))).toBe(true);
  });

  it("lässt eine manuell gesetzte Aktion die Regelempfehlung überstimmen", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);
    const ref = { kind: "DEAL" as const, id: deal.id };

    const state = await setManualNextAction(ctx, ref, {
      type: "CALL",
      title: "Herrn Nord persönlich anrufen",
      reason: "Auf der Messe zugesagt.",
      dueAt: new Date(Date.now() + 2 * DAY),
    });

    expect(state.current?.title).toBe("Herrn Nord persönlich anrufen");
    expect(state.current?.isManual).toBe(true);

    await reconcileSubject(ctx.organizationId, ref);
    const after = await getRecordActionState(ctx, ref);
    expect(after.current?.title).toBe("Herrn Nord persönlich anrufen");

    const engineProposals = await prisma.nextAction.count({
      where: { dealId: deal.id, isManual: false, status: { in: ["OPEN", "SNOOZED"] } },
    });
    expect(engineProposals).toBe(0);
  });

  it("dokumentiert Erledigen, Verschieben und Verwerfen nachvollziehbar", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);
    const ref = { kind: "DEAL" as const, id: deal.id };

    const open = await prisma.nextAction.findFirstOrThrow({ where: { dealId: deal.id, status: "OPEN" } });
    await completeNextAction(ctx, open.id, "Telefonisch geklärt.");

    const completed = await prisma.nextAction.findUniqueOrThrow({ where: { id: open.id } });
    expect(completed.status).toBe("DONE");
    expect(completed.completedById).toBe(ctx.userId);

    const manual = await setManualNextAction(ctx, ref, {
      type: "FOLLOW_UP",
      title: "Nachfassen nach Messe",
      reason: "Kunde bat um Rückmeldung nach der Messe.",
    });
    await snoozeNextAction(ctx, manual.current?.id as string, {
      until: new Date(Date.now() + 5 * DAY),
      reason: "Kunde ist bis Freitag nicht erreichbar.",
    });

    const snoozed = await prisma.nextAction.findUniqueOrThrow({ where: { id: manual.current?.id as string } });
    expect(snoozed.status).toBe("SNOOZED");

    const audit = await prisma.auditLog.findMany({
      where: { organizationId: ctx.organizationId, entityType: "NextAction" },
      select: { action: true },
    });
    expect(audit.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["next_action.completed", "next_action.snoozed", "next_action.set_manually"]),
    );
  });

  it("hält eine Wiedervorlage und begründet sie", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);
    const ref = { kind: "DEAL" as const, id: deal.id };
    const november = new Date(Date.now() + 60 * DAY);

    const state = await setRecall(ctx, ref, { at: november, reason: "Kunde meldet sich im November." });

    expect(state.state?.operationalState).toBe("SCHEDULED");
    expect(state.current?.reason).toContain("Wiedervorlage");
    expect(state.automations.some((automation) => automation.type === "RECALL")).toBe(true);
  });

  it("verwirft eine Empfehlung nur mit Begründung", async () => {
    const { ctx } = await createTestOrganization();
    const deal = await newDeal(ctx);
    const open = await prisma.nextAction.findFirstOrThrow({ where: { dealId: deal.id, status: "OPEN" } });

    await expect(dismissNextAction(ctx, open.id, { reason: "" })).rejects.toThrow();

    await dismissNextAction(ctx, open.id, { reason: "Kunde hat das Projekt intern verschoben." });
    const dismissed = await prisma.nextAction.findUniqueOrThrow({ where: { id: open.id } });
    expect(dismissed.status).toBe("DISMISSED");
    expect(dismissed.dismissReason).toContain("verschoben");
  });
});

describe("Eingehende Ereignisse anderer OKUN-Produkte", () => {
  it("ordnet Ereignisse über die Kontakt-E-Mail dem offenen Deal zu", async () => {
    const { ctx } = await createTestOrganization();
    const contact = await createContact(ctx, { firstName: "Petra", lastName: "Süd", email: "petra@sued.test" });
    const pipeline = await defaultPipeline(ctx);
    const deal = await createDeal(ctx, {
      name: "Onboarding Süd",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0].id,
      amount: 5_000,
      contactIds: [contact.id],
    });

    const results = await ingestEvents(ctx, {
      events: [
        {
          type: "CONTRACT_ACCEPTED",
          idempotencyKey: "deals-contract-991",
          target: { contactEmail: "petra@sued.test" },
          payload: { reference: "V-991" },
        },
      ],
    });

    expect(results[0].status).toBe("accepted");
    const event = await prisma.domainEventRecord.findFirstOrThrow({ where: { idempotencyKey: "deals-contract-991" } });
    expect(event.dealId).toBe(deal.id);
    expect(event.source).toBe("INTEGRATION");
    expect(event.processedAt).not.toBeNull();
  });

  it("meldet unauflösbare Ereignisse, statt Daten zu erfinden", async () => {
    const { ctx } = await createTestOrganization();
    const results = await ingestEvents(ctx, {
      events: [
        {
          type: "OFFER_SENT",
          idempotencyKey: "deals-offer-unknown-1",
          target: { contactEmail: "niemand@example.test" },
        },
      ],
    });

    expect(results[0].status).toBe("unmatched");
    expect(results[0].eventId).toBeNull();
  });

  it("bindet einen API-Key fest an seine Organisation", async () => {
    const { ctx } = await createTestOrganization();
    const created = await createApiKey(ctx, { name: "OKUN Deals", scopes: ["events:write"] });

    expect(created.key.startsWith("okun_ck_")).toBe(true);
    const principal = await authenticateApiKey(`Bearer ${created.key}`);
    expect(principal.organizationId).toBe(ctx.organizationId);
    expect(principal.scopes).toEqual(["events:write"]);

    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.keyHash).not.toContain(created.key);
  });
});

describe("Mandantentrennung der Active-CRM-Ebene", () => {
  it("zeigt keine Aktionen, Ereignisse oder Automationen fremder Organisationen", async () => {
    const { ctx: alpha } = await createTestOrganization({ name: "Alpha" });
    const { ctx: beta } = await createTestOrganization({ name: "Beta" });

    const alphaDeal = await newDeal(alpha, "Alpha-Deal");
    await newDeal(beta, "Beta-Deal");

    const betaCenter = await getActionCenter(beta, { scope: "team" });
    const labels = betaCenter.buckets.flatMap((bucket) => bucket.items.map((item) => item.record.label));
    expect(labels).not.toContain("Alpha-Deal");

    await expect(getRecordActionState(beta, { kind: "DEAL", id: alphaDeal.id })).rejects.toThrow();

    const betaEvents = await prisma.domainEventRecord.count({
      where: { organizationId: beta.organizationId, dealId: alphaDeal.id },
    });
    expect(betaEvents).toBe(0);
  });
});
