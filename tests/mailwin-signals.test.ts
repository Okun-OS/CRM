import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { createContact } from "@/server/services/contacts";
import { changeDealStage } from "@/server/services/deals";
import { acceptSuggestion, rejectSuggestion } from "@/server/services/suggestions";
import { processDueWebhookDeliveries } from "@/server/services/webhooks";
import { createMailwinKey, saveMailwinWebhook } from "@/server/mailwin/settings";
import { saveSignalSettings } from "@/server/mailwin/signal-settings";
import { POST as postLeads } from "@/app/api/mailwin/v1/leads/route";
import { GET as getLead } from "@/app/api/mailwin/v1/leads/[id]/route";
import { POST as postSignal } from "@/app/api/mailwin/v1/leads/[id]/signals/route";
import { POST as postTask } from "@/app/api/mailwin/v1/tasks/route";
import { POST as postContactSuggestion } from "@/app/api/mailwin/v1/contacts/[id]/suggestions/route";
import { POST as postReply } from "@/app/api/mailwin/v1/outreach/replies/route";
import { createTestOrganization, defaultPipeline } from "./setup/factories";

/**
 * Mailwin Connect API v1.2 — Signale, Vorschläge und Kontext. Geprüft über
 * die echten Route-Handler.
 */
type Handler = (req: NextRequest, segment: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(handler: Handler, method: "GET" | "POST", path: string, key: string, body?: unknown, params: Record<string, string> = {}) {
  const response = await handler(
    new NextRequest(`http://localhost${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve(params) },
  );
  return { status: response.status, json: await response.json() };
}

async function setup() {
  const org = await createTestOrganization();
  const { key } = await createMailwinKey(org.ctx, { name: "Signale" });
  const lead = await call(postLeads, "POST", "/api/mailwin/v1/leads", key, {
    contact: { email: "kundin@beispiel.de", name: "Karla Kundin" },
    companyName: "Beispiel GmbH",
    title: "Wartungsvertrag",
    description: "Anfrage per E-Mail",
    source: "mailwin",
    sourceRef: { channel: "email", threadId: "thr_1", messageId: "msg_1", url: "https://okun-mailwin.com/t/1" },
  });
  const pipeline = await defaultPipeline(org.ctx);
  const stage = (key: string) => pipeline.stages.find((entry) => entry.key === key)!;
  return { ...org, key, leadId: lead.json.id as string, pipeline, stage };
}

const signal = (leadId: string, key: string, body: Record<string, unknown>) =>
  call(postSignal, "POST", `/api/mailwin/v1/leads/${leadId}/signals`, key, { occurredAt: "2026-10-28T10:00:00+01:00", ...body }, { id: leadId });

beforeEach(() => resetRateLimits());

describe("Signale — Angebot", () => {
  it("rückt bei „Angebot gesendet“ in die Phase Angebot vor, übernimmt den Wert und plant das Nachfassen", async () => {
    const { key, leadId, stage, organization } = await setup();
    const response = await signal(leadId, key, {
      signal: "offer_sent",
      externalId: "msg_2",
      summary: "Angebot 2026-117 als PDF verschickt",
      url: "https://okun-mailwin.com/t/1#msg_2",
      evidence: { quote: "anbei unser Angebot", confidence: 0.94 },
      data: { valueCents: 2_400_000, offerNumber: "2026-117" },
    });

    expect(response.status).toBe(201);
    expect(response.json).toMatchObject({
      signal: "offer_sent",
      duplicate: false,
      applied: expect.arrayContaining(["timeline", "stage_changed:Angebot", "value_updated"]),
      proposed: [],
      lead: { id: leadId, status: "open", stage: { id: stage("proposal").id, name: "Angebot" }, valueCents: 2_400_000 },
    });

    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: leadId } });
    expect(deal.offerSentAt?.toISOString()).toBe("2026-10-28T09:00:00.000Z");
    expect(deal.nextActionTitle).toBe("Angebot nachfassen");

    const timeline = await prisma.activity.findFirstOrThrow({
      where: { organizationId: organization.id, dealId: leadId, externalSource: "mailwin:signal" },
    });
    expect(timeline).toMatchObject({ source: "MAILWIN", subject: "Angebot gesendet (erkannt von Mailwin)" });
    expect(timeline.body).toContain("anbei unser Angebot");
  });

  it("geht nur vorwärts und überschreibt einen bestehenden Wert nicht still", async () => {
    const { ctx, key, leadId, stage } = await setup();
    await changeDealStage(ctx, leadId, { stageId: stage("negotiation").id });
    await prisma.deal.update({ where: { id: leadId }, data: { amount: 5000 } });

    const response = await signal(leadId, key, { signal: "offer_sent", externalId: "msg_3", data: { valueCents: 999_00 } });
    expect(response.json.lead.stage.id).toBe(stage("negotiation").id);
    expect(response.json.lead.valueCents).toBe(500_000);
    expect(response.json.ignored).toEqual(expect.arrayContaining([expect.stringMatching(/^stage:/)]));
    expect(response.json.proposed).toEqual([
      expect.objectContaining({ kind: "deal.update_value", title: expect.stringMatching(/^Wert auf 999\s€ aktualisieren\?$/) }),
    ]);
  });

  it("ist über signal + externalId idempotent", async () => {
    const { key, leadId, organization } = await setup();
    const first = await signal(leadId, key, { signal: "offer_sent", externalId: "msg_4" });
    const second = await signal(leadId, key, { signal: "offer_sent", externalId: "msg_4" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ duplicate: true, applied: first.json.applied });
    expect(
      await prisma.activity.count({ where: { organizationId: organization.id, externalSource: "mailwin:signal" } }),
    ).toBe(1);
  });

  it("macht aus „Angebot angenommen“ standardmäßig einen Vorschlag, den ein Mensch annimmt", async () => {
    const { ctx, key, leadId } = await setup();
    const response = await signal(leadId, key, {
      signal: "offer_accepted",
      externalId: "msg_5",
      summary: "Kundin nimmt das Angebot an",
      evidence: { quote: "Wir nehmen Ihr Angebot gerne an.", confidence: 0.97 },
    });

    expect(response.json.applied).not.toContain("won");
    expect(response.json.proposed).toEqual([expect.objectContaining({ kind: "deal.mark_won", title: "Als gewonnen markieren?" })]);
    expect(response.json.lead).toMatchObject({ status: "open", nextAction: { title: "Als gewonnen markieren?" } });

    await acceptSuggestion(ctx, response.json.proposed[0].id);
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: leadId } });
    expect(deal.status).toBe("WON");
    const suggestion = await prisma.recordSuggestion.findUniqueOrThrow({ where: { id: response.json.proposed[0].id } });
    expect(suggestion.status).toBe("ACCEPTED");
  });

  it("setzt Gewonnen nur automatisch, wenn so eingestellt und die Verlässlichkeit reicht", async () => {
    const { ctx, key, leadId } = await setup();
    await saveSignalSettings(ctx, { acceptance: "auto", autoMinConfidence: 0.9 });

    const unsure = await signal(leadId, key, { signal: "offer_accepted", externalId: "msg_6", evidence: { confidence: 0.6 } });
    expect(unsure.json.proposed).toHaveLength(1);
    expect(unsure.json.lead.status).toBe("open");

    // Ohne wörtliches Zitat bleibt es trotz hoher Verlässlichkeit ein Vorschlag.
    const noQuote = await signal(leadId, key, { signal: "offer_accepted", externalId: "msg_6b", evidence: { confidence: 0.95 } });
    expect(noQuote.json.proposed).toHaveLength(1);
    expect(noQuote.json.ignored).toEqual([expect.stringContaining("ohne wörtliches Zitat")]);
    expect(noQuote.json.lead.status).toBe("open");

    const sure = await signal(leadId, key, {
      signal: "offer_accepted",
      externalId: "msg_7",
      evidence: { confidence: 0.95, quote: "Hiermit nehmen wir Ihr Angebot an." },
    });
    expect(sure.json.applied).toContain("won");
    expect(sure.json.lead.status).toBe("won");
  });

  it("schlägt bei einer Absage „verloren“ vor; Verwerfen lässt den Lead offen", async () => {
    const { ctx, key, leadId } = await setup();
    const response = await signal(leadId, key, {
      signal: "offer_declined",
      externalId: "msg_8",
      data: { reason: "Budget für dieses Jahr gestrichen" },
    });
    const [proposal] = response.json.proposed;
    expect(proposal.kind).toBe("deal.mark_lost");
    const stored = await prisma.recordSuggestion.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(stored.payload).toMatchObject({ lostReason: "Budget für dieses Jahr gestrichen" });

    await rejectSuggestion(ctx, proposal.id);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: leadId } })).status).toBe("OPEN");
    expect((await prisma.recordSuggestion.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("REJECTED");
  });

  it("protokolliert bei einem abgeschlossenen Lead nur noch", async () => {
    const { ctx, key, leadId, pipeline } = await setup();
    await changeDealStage(ctx, leadId, { stageId: pipeline.stages.find((entry) => entry.type === "WON")!.id });
    const response = await signal(leadId, key, { signal: "offer_sent", externalId: "msg_9" });
    expect(response.json.applied).toEqual(["timeline"]);
    expect(response.json.ignored[0]).toMatch(/^lead_closed/);
  });

  it("ändert keine Phase, wenn die Zuordnung „nicht ändern“ lautet", async () => {
    const { ctx, key, leadId, pipeline, stage } = await setup();
    await saveSignalSettings(ctx, { stageMapping: { [pipeline.id]: { offer_sent: null } } });
    const response = await signal(leadId, key, { signal: "offer_sent", externalId: "msg_10" });
    expect(response.json.lead.stage.id).toBe(stage("lead").id);
  });
});

describe("Signale — Termine, Rückfragen, Abwesenheit", () => {
  it("legt bei „Termin vereinbart“ einen Kalendertermin an und rückt in die Phase Termin vor", async () => {
    const { key, leadId, stage } = await setup();
    const response = await signal(leadId, key, {
      signal: "meeting_booked",
      externalId: "msg_11",
      data: { startAt: "2026-11-10T10:00:00+01:00", title: "Begehung Standort Nord", location: "Hamburg" },
    });
    expect(response.json.applied).toEqual(expect.arrayContaining(["meeting_created", "stage_changed:Termin"]));
    const meeting = await prisma.meeting.findFirstOrThrow({ where: { dealId: leadId } });
    expect(meeting).toMatchObject({ title: "Begehung Standort Nord", location: "Hamburg" });
    expect(meeting.endAt.getTime() - meeting.startAt.getTime()).toBe(60 * 60_000);
    expect(response.json.lead.stage.id).toBe(stage("meeting").id);
    // Das aktive CRM kennt den Termin und kann „Termin vorbereiten“ vorschlagen.
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: leadId } });
    expect(deal.nextMeetingAt?.toISOString()).toBe("2026-11-10T09:00:00.000Z");
  });

  it("macht aus einer Rückfrage die nächste Aktion", async () => {
    const { key, leadId } = await setup();
    const response = await signal(leadId, key, { signal: "question", externalId: "msg_12", summary: "Gibt es eine Staffel ab 100 Stück?" });
    expect(response.json.lead.nextAction.title).toBe("Rückfrage beantworten");
  });

  it("setzt Ereigniszeitpunkte in der Zukunft auf jetzt", async () => {
    const { key, leadId } = await setup();
    const before = Date.now();
    await signal(leadId, key, { signal: "offer_sent", externalId: "msg_future", occurredAt: "2099-01-01T00:00:00Z" });
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: leadId } });
    expect(deal.offerSentAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(deal.offerSentAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("pausiert bei einer Abwesenheitsnotiz die Automationen — ohne sie als Antwort zu werten", async () => {
    const { key, leadId } = await setup();
    const before = await prisma.deal.findUniqueOrThrow({ where: { id: leadId } });
    const until = new Date(Date.now() + 5 * 24 * 60 * 60_000);
    const response = await signal(leadId, key, {
      signal: "out_of_office",
      externalId: "msg_13",
      occurredAt: new Date().toISOString(),
      data: { until: until.toISOString() },
    });
    expect(response.json.applied).toContain("automation_paused");
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: leadId } });
    expect(deal.automationPausedUntil?.getTime()).toBe(new Date(until.toISOString()).getTime());
    expect(deal.lastCustomerResponseAt).toEqual(before.lastCustomerResponseAt);
  });

  it("antwortet für einen fremden oder unbekannten Lead mit 404", async () => {
    const own = await setup();
    const foreign = await setup();
    const response = await signal(foreign.leadId, own.key, { signal: "offer_sent", externalId: "x" });
    expect(response.status).toBe(404);
    expect(await prisma.activity.count({ where: { dealId: foreign.leadId, externalSource: "mailwin:signal" } })).toBe(0);
  });
});

describe("Lead-Kontext, Aufgaben, Kontaktvorschläge", () => {
  it("liefert den Kontext eines Leads für Antwortentwürfe", async () => {
    const { key, leadId } = await setup();
    await signal(leadId, key, { signal: "offer_sent", externalId: "msg_14" });
    const response = await call(getLead, "GET", `/api/mailwin/v1/leads/${leadId}`, key, undefined, { id: leadId });
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      id: leadId,
      title: "Wartungsvertrag",
      status: "open",
      stage: { name: "Angebot", type: "open" },
      contacts: [expect.objectContaining({ email: "kundin@beispiel.de", isPrimary: true })],
      nextAction: { title: "Angebot nachfassen" },
      offerSentAt: "2026-10-28T09:00:00.000Z",
      sourceRef: expect.objectContaining({ system: "mailwin" }),
    });
  });

  it("legt eine Aufgabe für den Owner des Leads an", async () => {
    const { key, leadId } = await setup();
    const response = await call(postTask, "POST", "/api/mailwin/v1/tasks", key, {
      title: "Kundin am Dienstag anrufen",
      dueAt: "2026-11-04T09:00:00+01:00",
      priority: "high",
      leadId,
      url: "https://okun-mailwin.com/t/1#msg_15",
    });
    expect(response.status).toBe(201);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: response.json.id } });
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: leadId } });
    expect(task).toMatchObject({ dealId: leadId, ownerId: deal.ownerId, priority: "HIGH" });
    expect(task.description).toContain("https://okun-mailwin.com/t/1#msg_15");
  });

  it("füllt leere Kontaktfelder und schlägt Abweichungen nur vor", async () => {
    const { ctx, key } = await setup();
    const contact = await createContact(ctx, { firstName: "Paul", lastName: "Pflege", email: "paul@kunde.de", jobTitle: "Einkauf" });
    const response = await call(
      postContactSuggestion,
      "POST",
      `/api/mailwin/v1/contacts/${contact.id}/suggestions`,
      key,
      { fields: { phone: "+49 30 999", jobTitle: "Leitung Einkauf" }, evidence: { quote: "Paul Pflege · Leitung Einkauf · +49 30 999" } },
      { id: contact.id },
    );
    expect(response.status).toBe(200);
    expect(response.json.applied).toEqual(["phone"]);
    expect(response.json.proposed.fields).toEqual(["jobTitle"]);
    expect(response.json.contact.phone).toBe("+49 30 999");
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).jobTitle).toBe("Einkauf");

    // Dieselbe Meldung erneut legt keinen zweiten Vorschlag an.
    await call(postContactSuggestion, "POST", `/api/mailwin/v1/contacts/${contact.id}/suggestions`, key, { fields: { jobTitle: "Leitung Einkauf" } }, { id: contact.id });
    expect(await prisma.recordSuggestion.count({ where: { contactId: contact.id, status: "PENDING" } })).toBe(1);

    await acceptSuggestion(ctx, response.json.proposed.id);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).jobTitle).toBe("Leitung Einkauf");
  });
});

describe("Akquise-Antworten", () => {
  it("übernimmt Mailwins Einstufung: Abmeldung sperrt die Adresse, eine Wiederholung zählt nicht doppelt", async () => {
    const { organization, key } = await setup();
    const prospect = await prisma.prospect.create({
      data: { organizationId: organization.id, companyName: "Kalt AG", email: "info@kalt-ag.de", sourceKey: "manual", stage: "IN_SEQUENCE" },
    });

    const body = {
      messageId: "reply_1",
      fromAddress: "INFO@kalt-ag.de",
      subject: "Re: Kurze Frage",
      body: "Bitte nehmen Sie mich aus Ihrem Verteiler.",
      receivedAt: "2026-10-28T11:00:00+01:00",
      classification: "unsubscribe",
      confidence: 0.98,
    };
    const first = await call(postReply, "POST", "/api/mailwin/v1/outreach/replies", key, body);
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ prospectId: prospect.id, classification: "unsubscribe", duplicate: false });

    const stored = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
    expect(stored.stage).toBe("DO_NOT_CONTACT");
    expect(await prisma.suppressionEntry.count({ where: { organizationId: organization.id, value: "info@kalt-ag.de" } })).toBe(1);

    const again = await call(postReply, "POST", "/api/mailwin/v1/outreach/replies", key, body);
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
    expect(await prisma.emailMessage.count({ where: { organizationId: organization.id, providerMessageId: "reply_1" } })).toBe(1);
  });
});

describe("Webhook lead.next_action_changed", () => {
  let server: Server;
  let url: string;
  const received: { type: string; data: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("meldet Mailwin die neue nächste Aktion mit Fälligkeit", async () => {
    const { ctx, key, leadId } = await setup();
    await saveMailwinWebhook(ctx, { url, secret: "next-action-geheimnis-0123456789", events: ["lead.next_action_changed"], isActive: true });
    received.length = 0;

    await signal(leadId, key, { signal: "offer_sent", externalId: "msg_16" });
    await processDueWebhookDeliveries();

    const event = received.find((entry) => entry.type === "lead.next_action_changed" && (entry.data.nextAction as { title: string }).title === "Angebot nachfassen");
    expect(event).toBeDefined();
    expect(event!.data).toMatchObject({
      lead: { id: leadId, stage: { name: "Angebot" } },
      nextAction: { type: "chase_offer", title: "Angebot nachfassen", dueAt: expect.any(String) },
    });
  });
});
