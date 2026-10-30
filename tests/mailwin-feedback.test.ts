import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { createContact } from "@/server/services/contacts";
import { changeDealStage, deleteDeal } from "@/server/services/deals";
import { mergeContacts } from "@/server/services/duplicates";
import { snoozeNextAction } from "@/server/services/next-actions";
import { acceptSuggestion, rejectSuggestion } from "@/server/services/suggestions";
import { processDueWebhookDeliveries } from "@/server/services/webhooks";
import { createMailwinKey, saveMailwinWebhook } from "@/server/mailwin/settings";
import { saveSignalSettings } from "@/server/mailwin/signal-settings";
import { announceDueNextActions, DUE_ANNOUNCE_WINDOW_MS } from "@/server/mailwin/webhooks";
import { POST as postLeads } from "@/app/api/mailwin/v1/leads/route";
import { GET as getLead } from "@/app/api/mailwin/v1/leads/[id]/route";
import { POST as postSignal } from "@/app/api/mailwin/v1/leads/[id]/signals/route";
import { POST as postActivities } from "@/app/api/mailwin/v1/activities/route";
import { POST as postTask } from "@/app/api/mailwin/v1/tasks/route";
import { POST as postContactSuggestion } from "@/app/api/mailwin/v1/contacts/[id]/suggestions/route";
import { POST as postReply } from "@/app/api/mailwin/v1/outreach/replies/route";
import { createTestOrganization, defaultPipeline } from "./setup/factories";

/**
 * Rückmeldung der Mailwin-Seite zu v1.2 (`docs/mailwin/ANTWORT-AN-MAILWIN-V1.2.md`):
 * Webhook-Erweiterungen, geschärfte Signal-Regeln und die erbetenen
 * Bestätigungen — geprüft über die echten Route-Handler.
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
  const { key } = await createMailwinKey(org.ctx, { name: "Rückmeldung" });
  const lead = await call(postLeads, "POST", "/api/mailwin/v1/leads", key, {
    contact: { email: "erika@kunde.de", name: "Erika Musterfrau" },
    companyName: "Kunde GmbH",
    title: "Rahmenvertrag 2027",
    description: "Anfrage per E-Mail",
    source: "mailwin",
    sourceRef: {
      channel: "email",
      threadId: "6f1c0a52-thread",
      messageId: "9b2e7d10-message",
      url: "https://okun-mailwin.com/emails/6f1c0a52-thread",
    },
  });
  const contact = await prisma.dealContact.findFirstOrThrow({ where: { dealId: lead.json.id } });
  const pipeline = await defaultPipeline(org.ctx);
  const stage = (key: string) => pipeline.stages.find((entry) => entry.key === key)!;
  return { ...org, key, leadId: lead.json.id as string, contactId: contact.contactId, pipeline, stage };
}

const signal = (leadId: string, key: string, body: Record<string, unknown>) =>
  call(postSignal, "POST", `/api/mailwin/v1/leads/${leadId}/signals`, key, { occurredAt: "2026-10-28T10:00:00Z", ...body }, { id: leadId });

const activity = (extra: Record<string, unknown>) => ({
  type: "email",
  direction: "inbound",
  summary: "Danke, wir melden uns.",
  occurredAt: "2026-10-28T12:00:00Z",
  externalId: "email:msg-1",
  url: "https://okun-mailwin.com/emails/6f1c0a52-thread#m-msg-1",
  ...extra,
});

/** Nur die Felder, auf die die Tests zugreifen; der Rest wird mit toMatchObject geprüft. */
type Envelope = { id: string; type: string; workspaceId: string; data: Record<string, { id: string; dueAt: string }> };

let server: Server;
let hookUrl: string;
const received: { headers: IncomingMessage["headers"]; envelope: Envelope }[] = [];
const SECRET = "rueckmeldung-geheimnis-0123456789";

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ headers: req.headers, envelope: JSON.parse(body) });
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook?i=int_7`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  resetRateLimits();
  received.length = 0;
});

const events = (type: string) => received.map((entry) => entry.envelope).filter((envelope) => envelope.type === type);

describe("Webhooks: Arbeitsbereich, gelöschte Leads, zusammengeführte Kontakte", () => {
  it("nennt den Arbeitsbereich in jedem Umschlag und als Header", async () => {
    const { ctx, organization, leadId, stage } = await setup();
    await saveMailwinWebhook(ctx, { url: hookUrl, secret: SECRET, events: ["lead.stage_changed"], isActive: true });
    await changeDealStage(ctx, leadId, { stageId: stage("qualified").id });
    await processDueWebhookDeliveries();

    const [entry] = received;
    expect(entry.envelope.workspaceId).toBe(organization.id);
    expect(entry.headers["x-okun-workspace"]).toBe(organization.id);
  });

  it("meldet lead.deleted mit der ID des gelöschten Leads", async () => {
    const { ctx, organization, leadId } = await setup();
    await saveMailwinWebhook(ctx, { url: hookUrl, secret: SECRET, events: ["lead.deleted"], isActive: true });
    await deleteDeal(ctx, leadId);
    await processDueWebhookDeliveries();

    expect(events("lead.deleted")).toEqual([
      expect.objectContaining({ workspaceId: organization.id, data: { id: leadId } }),
    ]);
  });

  it("meldet contact.merged und hängt offene Vorschläge an den verbleibenden Kontakt", async () => {
    const { ctx, key } = await setup();
    await saveMailwinWebhook(ctx, { url: hookUrl, secret: SECRET, events: ["contact.merged"], isActive: true });
    const primary = await createContact(ctx, { firstName: "Paul", lastName: "Pflege", email: "paul@kunde.de", jobTitle: "Einkauf" });
    const duplicate = await createContact(ctx, { firstName: "Paul", lastName: "Pflege", email: "p.pflege@kunde.de", jobTitle: "Einkauf" });
    const proposal = await call(
      postContactSuggestion,
      "POST",
      `/api/mailwin/v1/contacts/${duplicate.id}/suggestions`,
      key,
      { fields: { jobTitle: "Leitung Einkauf" } },
      { id: duplicate.id },
    );

    await mergeContacts(ctx, primary.id, duplicate.id);
    await processDueWebhookDeliveries();

    const [merged] = events("contact.merged");
    expect(merged.data).toMatchObject({ fromId: duplicate.id, intoId: primary.id, contact: { id: primary.id, email: "paul@kunde.de" } });
    const moved = await prisma.recordSuggestion.findUniqueOrThrow({ where: { id: proposal.json.proposed.id } });
    expect(moved.contactId).toBe(primary.id);
  });

  it("bestätigt: Ein wieder geöffneter Lead kommt als lead.stage_changed mit status open", async () => {
    const { ctx, leadId, pipeline, stage } = await setup();
    await saveMailwinWebhook(ctx, { url: hookUrl, secret: SECRET, events: ["lead.stage_changed"], isActive: true });
    const won = pipeline.stages.find((entry) => entry.type === "WON")!;
    await changeDealStage(ctx, leadId, { stageId: won.id });
    await changeDealStage(ctx, leadId, { stageId: stage("negotiation").id });
    await processDueWebhookDeliveries();

    const reopened = events("lead.stage_changed").find((envelope) => envelope.data.previousStage?.id === won.id);
    expect(reopened?.data.lead).toMatchObject({ id: leadId, status: "open", stage: { id: stage("negotiation").id } });
  });
});

describe("Webhook signal.proposal_resolved", () => {
  it("meldet, ob ein Mensch einen Vorschlag übernommen oder verworfen hat", async () => {
    const { ctx, leadId, key } = await setup();
    await saveMailwinWebhook(ctx, { url: hookUrl, secret: SECRET, events: ["signal.proposal_resolved"], isActive: true });

    const accepted = await signal(leadId, key, {
      signal: "offer_accepted",
      externalId: "email:msg-ok",
      evidence: { quote: "Wir nehmen Ihr Angebot an.", confidence: 0.82 },
    });
    await acceptSuggestion(ctx, accepted.json.proposed[0].id);
    await processDueWebhookDeliveries();

    expect(events("signal.proposal_resolved")).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          proposalId: accepted.json.proposed[0].id,
          kind: "deal.mark_won",
          accepted: true,
          signal: "offer_accepted",
          externalId: "email:msg-ok",
          confidence: 0.82,
          leadId,
          contactId: null,
          resolvedAt: expect.any(String),
        }),
      }),
    ]);
  });

  it("meldet auch das Verwerfen eines Kontaktvorschlags", async () => {
    const { ctx, key, contactId } = await setup();
    await saveMailwinWebhook(ctx, { url: hookUrl, secret: SECRET, events: ["signal.proposal_resolved"], isActive: true });
    await prisma.contact.update({ where: { id: contactId }, data: { jobTitle: "Einkauf" } });
    const proposal = await call(
      postContactSuggestion,
      "POST",
      `/api/mailwin/v1/contacts/${contactId}/suggestions`,
      key,
      { fields: { jobTitle: "Geschäftsführung" }, externalId: "signature:msg-7" },
      { id: contactId },
    );
    await rejectSuggestion(ctx, proposal.json.proposed.id);
    await processDueWebhookDeliveries();

    expect(events("signal.proposal_resolved")[0].data).toMatchObject({
      proposalId: proposal.json.proposed.id,
      kind: "contact.update",
      accepted: false,
      externalId: "signature:msg-7",
      contactId,
      leadId: null,
    });
  });
});

describe("Webhook lead.next_action_due", () => {
  it("meldet eine fällig gewordene nächste Aktion genau einmal", async () => {
    const { ctx, organization, leadId, key } = await setup();
    await saveMailwinWebhook(ctx, { url: hookUrl, secret: SECRET, events: ["lead.next_action_due"], isActive: true });
    await signal(leadId, key, { signal: "offer_sent", externalId: "email:msg-offer" });
    const action = await prisma.nextAction.findFirstOrThrow({ where: { dealId: leadId, status: "OPEN" } });
    expect(action.type).toBe("CHASE_OFFER");

    const now = new Date(action.dueAt!.getTime() + 60_000);
    await announceDueNextActions(now);
    await announceDueNextActions(now);
    await processDueWebhookDeliveries();

    const due = events("lead.next_action_due").filter((envelope) => envelope.data.lead.id === leadId);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      workspaceId: organization.id,
      data: {
        lead: { id: leadId, title: "Rahmenvertrag 2027" },
        nextAction: { id: action.id, type: "chase_offer", title: "Angebot nachfassen", dueAt: action.dueAt!.toISOString() },
      },
    });
  });

  it("meldet nach dem Verschieben zum neuen Termin erneut", async () => {
    const { ctx, leadId, key } = await setup();
    await saveMailwinWebhook(ctx, { url: hookUrl, secret: SECRET, events: ["lead.next_action_due"], isActive: true });
    await signal(leadId, key, { signal: "offer_sent", externalId: "email:msg-offer" });
    const action = await prisma.nextAction.findFirstOrThrow({ where: { dealId: leadId, status: "OPEN" } });
    await announceDueNextActions(new Date(action.dueAt!.getTime() + 60_000));

    const until = new Date(Math.max(Date.now(), action.dueAt!.getTime()) + 3 * 24 * 60 * 60_000);
    await snoozeNextAction(ctx, action.id, { until, reason: "Kundin ist im Urlaub" });
    await announceDueNextActions(new Date(until.getTime() + 60_000));
    await processDueWebhookDeliveries();

    const due = events("lead.next_action_due").filter((envelope) => envelope.data.lead.id === leadId);
    expect(due.map((envelope) => envelope.data.nextAction.dueAt)).toEqual([action.dueAt!.toISOString(), until.toISOString()]);
  });

  it("meldet lange Überfälliges nicht nach und interne Schritte gar nicht", async () => {
    const { ctx, leadId, key } = await setup();
    await saveMailwinWebhook(ctx, { url: hookUrl, secret: SECRET, events: ["lead.next_action_due"], isActive: true });
    await signal(leadId, key, { signal: "offer_sent", externalId: "email:msg-offer" });
    const stale = await prisma.nextAction.findFirstOrThrow({ where: { dealId: leadId, status: "OPEN" } });
    await announceDueNextActions(new Date(stale.dueAt!.getTime() + DUE_ANNOUNCE_WINDOW_MS + 60_000));
    expect((await prisma.nextAction.findUniqueOrThrow({ where: { id: stale.id } })).dueAnnouncedAt).not.toBeNull();

    // „Rückfrage beantworten“ ist ein interner Schritt (Typ CUSTOM).
    await signal(leadId, key, { signal: "question", externalId: "email:msg-q", summary: "Gibt es Mengenrabatt?" });
    const question = await prisma.nextAction.findFirstOrThrow({ where: { dealId: leadId, status: "OPEN" } });
    expect(question.type).toBe("CUSTOM");
    await announceDueNextActions(new Date(Date.now() + 60_000));
    await processDueWebhookDeliveries();

    expect(events("lead.next_action_due").filter((envelope) => envelope.data.lead.id === leadId)).toHaveLength(0);
    expect((await prisma.nextAction.findUniqueOrThrow({ where: { id: question.id } })).dueAnnouncedAt).toBeNull();
  });

  it("meldet nichts ohne abonnierten Mailwin-Webhook", async () => {
    const { leadId, key } = await setup();
    await signal(leadId, key, { signal: "offer_sent", externalId: "email:msg-offer" });
    const action = await prisma.nextAction.findFirstOrThrow({ where: { dealId: leadId, status: "OPEN" } });
    await announceDueNextActions(new Date(action.dueAt!.getTime() + 60_000));
    expect((await prisma.nextAction.findUniqueOrThrow({ where: { id: action.id } })).dueAnnouncedAt).toBeNull();
  });
});

describe("Signale nach der Rückmeldung", () => {
  it("begrenzt das Zitat auf 300 Zeichen", async () => {
    const { leadId, key } = await setup();
    const response = await signal(leadId, key, { signal: "question", externalId: "email:long", evidence: { quote: "x".repeat(301) } });
    expect(response.status).toBe(422);
    expect(response.json.error.details.fields).toHaveProperty(["evidence.quote"]);
  });

  it("liefert die nächste Aktion maschinenlesbar mit Typ", async () => {
    const { leadId, key } = await setup();
    const response = await signal(leadId, key, { signal: "offer_sent", externalId: "email:msg-offer" });
    expect(response.json.lead.nextAction).toEqual({ type: "chase_offer", title: "Angebot nachfassen", dueAt: expect.any(String) });
  });

  it("schlägt einen abweichenden Angebotswert vor, ohne das Nachfassen zu verdrängen", async () => {
    const { ctx, leadId, key } = await setup();
    await prisma.deal.update({ where: { id: leadId }, data: { amount: 5000 } });
    const response = await signal(leadId, key, { signal: "offer_sent", externalId: "email:msg-offer", data: { valueCents: 2_400_000 } });

    expect(response.json.applied).not.toContain("value_updated");
    expect(response.json.proposed).toEqual([
      expect.objectContaining({ kind: "deal.update_value", title: expect.stringMatching(/^Wert auf 24\.000\s€ aktualisieren\?$/) }),
    ]);
    expect(response.json.lead).toMatchObject({ valueCents: 500_000, nextAction: { type: "chase_offer" } });

    // Dasselbe Angebot noch einmal (andere Nachricht) legt keinen zweiten Vorschlag an.
    const again = await signal(leadId, key, { signal: "offer_sent", externalId: "email:msg-offer-2", data: { valueCents: 2_400_000 } });
    expect(again.json.proposed[0].id).toBe(response.json.proposed[0].id);

    await acceptSuggestion(ctx, response.json.proposed[0].id);
    expect(Number((await prisma.deal.findUniqueOrThrow({ where: { id: leadId } })).amount)).toBe(24_000);
  });

  it("füllt bei Einstellung „fill“ nur leere Werte; das frühere „overwrite“ gilt als Vorschlag", async () => {
    const { ctx, organization, leadId, key } = await setup();
    await prisma.deal.update({ where: { id: leadId }, data: { amount: 5000 } });
    await saveSignalSettings(ctx, { offerValue: "fill" });
    const fill = await signal(leadId, key, { signal: "offer_sent", externalId: "email:a", data: { valueCents: 2_400_000 } });
    expect(fill.json.proposed).toEqual([]);
    expect(fill.json.ignored).toEqual(expect.arrayContaining([expect.stringMatching(/^value:/)]));

    await prisma.integrationSetting.update({
      where: { organizationId_integration: { organizationId: organization.id, integration: "mailwin" } },
      data: { config: { offerValue: "overwrite" } },
    });
    const legacy = await signal(leadId, key, { signal: "offer_sent", externalId: "email:b", data: { valueCents: 2_400_000 } });
    expect(legacy.json.proposed).toEqual([expect.objectContaining({ kind: "deal.update_value" })]);
    expect(legacy.json.lead.valueCents).toBe(500_000);
  });

  it("verliert automatisch nur mit Zitat", async () => {
    const { ctx, leadId, key } = await setup();
    await saveSignalSettings(ctx, { decline: "auto", autoMinConfidence: 0.9 });
    const withoutQuote = await signal(leadId, key, { signal: "offer_declined", externalId: "email:n1", evidence: { confidence: 0.99 } });
    expect(withoutQuote.json.lead.status).toBe("open");
    expect(withoutQuote.json.ignored).toEqual([expect.stringContaining("ohne wörtliches Zitat")]);

    const withQuote = await signal(leadId, key, {
      signal: "offer_declined",
      externalId: "email:n2",
      evidence: { confidence: 0.99, quote: "Wir haben uns für einen anderen Anbieter entschieden." },
    });
    expect(withQuote.json.lead.status).toBe("lost");
  });
});

describe("Bausteine nach der Rückmeldung", () => {
  it("GET /leads/{id} liefert die letzten fünf Aktivitäten", async () => {
    const { leadId, key } = await setup();
    for (let index = 1; index <= 7; index++) {
      await call(postActivities, "POST", "/api/mailwin/v1/activities", key, activity({
        leadId,
        externalId: `email:m${index}`,
        summary: `Nachricht ${index}`,
        occurredAt: `2026-10-2${index}T08:00:00Z`,
      }));
    }
    const response = await call(getLead, "GET", `/api/mailwin/v1/leads/${leadId}`, key, undefined, { id: leadId });
    expect(response.json.recentActivities.map((entry: { summary: string }) => entry.summary)).toEqual([
      "Nachricht 7", "Nachricht 6", "Nachricht 5", "Nachricht 4", "Nachricht 3",
    ]);
  });

  it("POST /tasks ist über externalId idempotent: 201, danach 200 mit derselben Aufgabe", async () => {
    const { organization, leadId, key } = await setup();
    const body = { title: "Kundin Dienstag anrufen", leadId, dueAt: "2026-11-03T09:00:00Z", externalId: "task:msg-9" };
    const first = await call(postTask, "POST", "/api/mailwin/v1/tasks", key, body);
    const second = await call(postTask, "POST", "/api/mailwin/v1/tasks", key, { ...body, title: "Anders formuliert" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ id: first.json.id, duplicate: true });
    expect(await prisma.task.count({ where: { organizationId: organization.id, dealId: leadId } })).toBe(1);
  });

  it("nimmt Adressen aus Signaturen an: leere Felder füllen, abweichende vorschlagen", async () => {
    const { key, contactId } = await setup();
    await prisma.contact.update({ where: { id: contactId }, data: { city: "Berlin" } });
    const response = await call(
      postContactSuggestion,
      "POST",
      `/api/mailwin/v1/contacts/${contactId}/suggestions`,
      key,
      { fields: { street: "Hafenstraße 4", postalCode: "20457", city: "Hamburg", country: "Deutschland" }, evidence: { quote: "Hafenstraße 4 · 20457 Hamburg" } },
      { id: contactId },
    );
    expect(response.status).toBe(200);
    expect(response.json.applied.sort()).toEqual(["country", "postalCode", "street"]);
    expect(response.json.proposed.fields).toEqual(["city"]);
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).toMatchObject({ street: "Hafenstraße 4", city: "Berlin" });
  });

  it("ordnet eine Sequenz-Antwort über In-Reply-To/References zu, auch von anderer Adresse", async () => {
    const { organization, key } = await setup();
    const prospect = await prisma.prospect.create({
      data: { organizationId: organization.id, companyName: "Kalt AG", email: "info@kalt-ag.de", sourceKey: "manual", stage: "IN_SEQUENCE" },
    });
    await prisma.emailMessage.create({
      data: {
        organizationId: organization.id,
        direction: "OUTBOUND",
        status: "SENT",
        subject: "Kurze Frage",
        bodyHtml: "<p>Hallo</p>",
        fromAddress: "vertrieb@okun.example",
        toAddresses: ["info@kalt-ag.de"],
        providerMessageId: "<seq-1@okun.example>",
        prospectId: prospect.id,
      },
    });

    const response = await call(postReply, "POST", "/api/mailwin/v1/outreach/replies", key, {
      messageId: "reply-assistenz-1",
      fromAddress: "assistenz@kalt-ag.de",
      subject: "Re: Kurze Frage",
      body: "Herr Kalt meldet sich nächste Woche.",
      receivedAt: "2026-10-28T11:00:00Z",
      classification: "later",
      confidence: 0.8,
      inReplyTo: "<unbekannt@mailer.example>",
      references: "<andere@okun.example> seq-1@okun.example",
    });
    expect(response.status).toBe(201);
    expect(response.json).toMatchObject({ prospectId: prospect.id, matchedBy: "message_id", classification: "later" });
  });
});

describe("Bestätigungen", () => {
  it("eine Aktivität ohne leadId beeinflusst das aktive CRM nicht", async () => {
    const { leadId, contactId, key } = await setup();
    const before = await prisma.deal.findUniqueOrThrow({ where: { id: leadId } });
    const response = await call(postActivities, "POST", "/api/mailwin/v1/activities", key, activity({
      contactId,
      summary: "[Automatische Antwort] Ich bin bis 4.11. nicht im Büro.",
    }));
    expect(response.status).toBe(201);

    const after = await prisma.deal.findUniqueOrThrow({ where: { id: leadId } });
    expect(after.lastCustomerResponseAt).toEqual(before.lastCustomerResponseAt);
    expect(after.nextActionTitle).toBe(before.nextActionTitle);
    expect(after.operationalState).toBe(before.operationalState);
    expect(
      await prisma.domainEventRecord.count({ where: { OR: [{ dealId: leadId }, { contactId }], type: "CUSTOMER_REPLIED" } }),
    ).toBe(0);
  });

  it("Aktivität, Signal, Aufgabe und Abruf an einem gelöschten Lead liefern 404", async () => {
    const { ctx, leadId, key } = await setup();
    await deleteDeal(ctx, leadId);

    const results = await Promise.all([
      call(postActivities, "POST", "/api/mailwin/v1/activities", key, activity({ leadId })),
      signal(leadId, key, { signal: "offer_sent", externalId: "email:gone" }),
      call(postTask, "POST", "/api/mailwin/v1/tasks", key, { title: "Anrufen", leadId }),
      call(getLead, "GET", `/api/mailwin/v1/leads/${leadId}`, key, undefined, { id: leadId }),
    ]);
    for (const result of results) {
      expect(result.status).toBe(404);
      expect(result.json.error.code).toBe("not_found");
    }
  });
});
