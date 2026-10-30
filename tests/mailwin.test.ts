import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { createApiKey } from "@/server/services/api-keys";
import { createContact } from "@/server/services/contacts";
import { changeDealStage } from "@/server/services/deals";
import { nextAttemptAt, processDueWebhookDeliveries } from "@/server/services/webhooks";
import { createMailwinKey, revokeMailwinKey, saveMailwinWebhook } from "@/server/mailwin/settings";
import { splitName } from "@/server/mailwin/service";
import { GET as getMe } from "@/app/api/mailwin/v1/me/route";
import { GET as getContacts, POST as postContacts } from "@/app/api/mailwin/v1/contacts/route";
import { GET as getPipelines } from "@/app/api/mailwin/v1/pipelines/route";
import { POST as postLeads } from "@/app/api/mailwin/v1/leads/route";
import { POST as postActivities } from "@/app/api/mailwin/v1/activities/route";
import { GET as getOpenApi } from "@/app/api/mailwin/v1/openapi.json/route";
import { createTestOrganization, defaultPipeline } from "./setup/factories";

/**
 * Mailwin Connect API v1 — geprüft über die echten Route-Handler, also mit
 * Statuscodes, Headern und Fehlerhülle, wie Mailwin sie sieht.
 */
type Handler = (req: NextRequest, segment: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(
  handler: Handler,
  method: "GET" | "POST",
  path: string,
  options: {
    key?: string | null;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
    params?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json", ...options.headers };
  if (options.key) headers.authorization = `Bearer ${options.key}`;
  const body = options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined);
  const response = await handler(new NextRequest(`http://localhost${path}`, { method, headers, body }), {
    params: Promise.resolve(options.params ?? {}),
  });
  const json = await response.json();
  return { status: response.status, json, headers: response.headers };
}

async function workspace(name?: string) {
  const org = await createTestOrganization({ name });
  const issued = await createMailwinKey(org.ctx, { name: "Mailwin Test" });
  return { ...org, key: issued.key, keyId: issued.id };
}

function leadBody(email: string, extra: Record<string, unknown> = {}) {
  return {
    contact: { email, name: "Erika Musterfrau" },
    companyName: "Beispiel AG",
    title: "Anfrage Rahmenvertrag",
    description: "Kundin fragt nach einem Angebot für 50 Lizenzen.",
    valueCents: 1_250_050,
    source: "mailwin",
    sourceRef: {
      channel: "email",
      threadId: "thr_123",
      messageId: "msg_456",
      url: "https://okun-mailwin.com/inbox/thr_123",
    },
    ...extra,
  };
}

beforeEach(() => resetRateLimits());

describe("Mailwin Connect API — Zugang", () => {
  it("lehnt fehlende, falsche und widerrufene Schlüssel mit 401 ab", async () => {
    const { ctx, key, keyId } = await workspace();

    const missing = await call(getMe, "GET", "/api/mailwin/v1/me");
    expect(missing.status).toBe(401);
    expect(missing.json.error.code).toBe("unauthorized");

    const wrong = await call(getMe, "GET", "/api/mailwin/v1/me", { key: `${key.slice(0, -4)}XXXX` });
    expect(wrong.status).toBe(401);

    expect((await call(getMe, "GET", "/api/mailwin/v1/me", { key })).status).toBe(200);
    await revokeMailwinKey(ctx, keyId);
    const revoked = await call(getMe, "GET", "/api/mailwin/v1/me", { key });
    expect(revoked.status).toBe(401);
    expect(revoked.json).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });

  it("lässt einen allgemeinen API-Key nicht an die Mailwin-Schnittstelle (403)", async () => {
    const { ctx } = await createTestOrganization();
    const general = await createApiKey(ctx, { name: "Ereignisse", scopes: ["events:write"] });
    const response = await call(getMe, "GET", "/api/mailwin/v1/me", { key: general.key });
    expect(response.status).toBe(403);
    expect(response.json.error.code).toBe("forbidden");
  });

  it("nennt den Arbeitsbereich des Schlüssels", async () => {
    const { organization, key } = await workspace("Mailwin Kunde GmbH");
    const response = await call(getMe, "GET", "/api/mailwin/v1/me", { key });
    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      workspaceId: organization.id,
      name: "Mailwin Kunde GmbH",
      appUrl: expect.stringMatching(/^https?:\/\//),
    });
    expect(response.headers.get("RateLimit-Limit")).toBe("120");
  });

  it("antwortet ab der 121. Anfrage pro Minute mit 429 und Retry-After", async () => {
    const { key } = await workspace();
    for (let index = 0; index < 120; index += 1) {
      const ok = await call(getMe, "GET", "/api/mailwin/v1/me", { key });
      expect(ok.status).toBe(200);
    }
    const limited = await call(getMe, "GET", "/api/mailwin/v1/me", { key });
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe("rate_limited");
    const retryAfter = Number(limited.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("protokolliert jeden Aufruf mit Herkunft Mailwin, ohne die E-Mail-Adresse", async () => {
    const { organization, key } = await workspace();
    await call(getContacts, "GET", "/api/mailwin/v1/contacts?email=geheim%40example.com", { key });
    const logs = await prisma.integrationRequestLog.findMany({ where: { organizationId: organization.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ integration: "mailwin", method: "GET", path: "/api/mailwin/v1/contacts", status: 200 });
    expect(JSON.stringify(logs)).not.toContain("geheim");
  });
});

describe("Mailwin Connect API — Mandantentrennung", () => {
  it("sieht und erreicht keine Daten eines fremden Arbeitsbereichs", async () => {
    const own = await workspace();
    const foreign = await workspace();

    const contact = await createContact(foreign.ctx, { firstName: "Fremd", lastName: "Person", email: "fremd@firma-b.de" });
    const pipeline = await defaultPipeline(foreign.ctx);

    const lookup = await call(getContacts, "GET", "/api/mailwin/v1/contacts?email=fremd@firma-b.de", { key: own.key });
    expect(lookup.status).toBe(200);
    expect(lookup.json).toEqual([]);

    const activity = await call(postActivities, "POST", "/api/mailwin/v1/activities", {
      key: own.key,
      body: {
        contactId: contact.id,
        type: "email",
        direction: "inbound",
        summary: "Versuch",
        occurredAt: "2026-10-30T09:00:00+01:00",
        externalId: "x-1",
        url: "https://okun-mailwin.com/m/1",
      },
    });
    expect(activity.status).toBe(404);

    const lead = await call(postLeads, "POST", "/api/mailwin/v1/leads", {
      key: own.key,
      body: leadBody("neu@firma-a.de", { pipelineId: pipeline.id }),
    });
    expect(lead.status).toBe(422);
    expect(await prisma.deal.count({ where: { organizationId: foreign.organization.id } })).toBe(0);

    const pipelines = await call(getPipelines, "GET", "/api/mailwin/v1/pipelines", { key: own.key });
    expect(pipelines.json.map((entry: { id: string }) => entry.id)).not.toContain(pipeline.id);
  });
});

describe("Mailwin Connect API — Kontakte", () => {
  it("legt über die E-Mail-Adresse an und ergänzt danach nur, ohne Doppelung", async () => {
    const { organization, key } = await workspace();

    const created = await call(postContacts, "POST", "/api/mailwin/v1/contacts", {
      key,
      body: { email: "Max.Mustermann@Kunde-Eins.de" },
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      name: "Max Mustermann",
      email: "max.mustermann@kunde-eins.de",
      phone: null,
      company: null,
      openLeads: [],
      url: expect.stringContaining(`/contacts/${created.json.id}`),
    });

    const updated = await call(postContacts, "POST", "/api/mailwin/v1/contacts", {
      key,
      body: {
        email: "MAX.MUSTERMANN@kunde-eins.de",
        name: "Maximilian Mustermann",
        phone: "+49 30 1234567",
        companyName: "Kunde Eins GmbH",
        companyDomain: "https://www.kunde-eins.de/",
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.json.id).toBe(created.json.id);
    expect(updated.json).toMatchObject({
      // Der aus der Adresse abgeleitete Name war ein Platzhalter und wird ersetzt.
      name: "Maximilian Mustermann",
      phone: "+49 30 1234567",
      company: { name: "Kunde Eins GmbH", domain: "kunde-eins.de" },
    });

    // Gepflegte Daten bleiben: ein zweiter Aufruf überschreibt nichts.
    const again = await call(postContacts, "POST", "/api/mailwin/v1/contacts", {
      key,
      body: { email: "max.mustermann@kunde-eins.de", name: "Irgendwer Anders", phone: "0000" },
    });
    expect(again.json).toMatchObject({ name: "Maximilian Mustermann", phone: "+49 30 1234567" });

    expect(await prisma.contact.count({ where: { organizationId: organization.id } })).toBe(1);
    const stored = await prisma.contact.findFirstOrThrow({ where: { organizationId: organization.id } });
    expect(stored.source).toBe("mailwin");

    const found = await call(getContacts, "GET", "/api/mailwin/v1/contacts?email=MAX.mustermann%40KUNDE-eins.de", { key });
    expect(found.json).toHaveLength(1);
  });

  it("ordnet die Firma über die Domain zu und ignoriert Freemail-Domains", async () => {
    const { organization, key } = await workspace();

    const first = await call(postContacts, "POST", "/api/mailwin/v1/contacts", {
      key,
      body: { email: "a@acme.de", name: "Anna Acme", companyName: "ACME", companyDomain: "acme.de" },
    });
    const second = await call(postContacts, "POST", "/api/mailwin/v1/contacts", {
      key,
      body: { email: "b@acme.de", name: "Bernd Acme", companyDomain: "ACME.de" },
    });
    expect(second.json.company.id).toBe(first.json.company.id);

    const freemail = await call(postContacts, "POST", "/api/mailwin/v1/contacts", {
      key,
      body: { email: "privat@gmail.com", name: "Paula Privat", companyDomain: "gmail.com" },
    });
    expect(freemail.json.company).toBeNull();
    expect(await prisma.company.count({ where: { organizationId: organization.id } })).toBe(1);
    const company = await prisma.company.findFirstOrThrow({ where: { organizationId: organization.id } });
    expect(company.source).toBe("mailwin");
  });

  it("legt bei gleichzeitigen Aufrufen für dieselbe Adresse nur einen Kontakt an", async () => {
    const { organization, key } = await workspace();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call(postContacts, "POST", "/api/mailwin/v1/contacts", { key, body: { email: "parallel@kunde.de" } }),
      ),
    );
    expect(new Set(results.map((result) => result.json.id)).size).toBe(1);
    expect(await prisma.contact.count({ where: { organizationId: organization.id } })).toBe(1);
  });

  it("zerlegt Namen und leitet fehlende aus der Adresse ab", () => {
    expect(splitName("Max Mustermann", "x@y.de")).toEqual({ firstName: "Max", lastName: "Mustermann" });
    expect(splitName("Mustermann, Max", "x@y.de")).toEqual({ firstName: "Max", lastName: "Mustermann" });
    expect(splitName("Anna Maria von Berg", "x@y.de")).toEqual({ firstName: "Anna Maria von", lastName: "Berg" });
    expect(splitName(undefined, "erika.musterfrau@firma.de")).toEqual({ firstName: "Erika", lastName: "Musterfrau" });
    expect(splitName("Cher", "x@y.de")).toEqual({ firstName: "Cher", lastName: "Unbekannt" });
    expect(splitName(undefined, "info@firma.de")).toEqual({ firstName: "Unbekannt", lastName: "info@firma.de" });
  });

  it("weist eine Abfrage ohne gültige Adresse mit 400 ab", async () => {
    const { key } = await workspace();
    const response = await call(getContacts, "GET", "/api/mailwin/v1/contacts", { key });
    expect(response.status).toBe(400);
    expect(response.json.error.code).toBe("invalid_request");
  });
});

describe("Mailwin Connect API — Pipelines und Leads", () => {
  it("liefert Pipelines mit geordneten Phasen, die Standard-Pipeline zuerst", async () => {
    const { ctx, key } = await workspace();
    const response = await call(getPipelines, "GET", "/api/mailwin/v1/pipelines", { key });
    expect(response.status).toBe(200);
    const pipeline = await defaultPipeline(ctx);
    expect(response.json[0]).toMatchObject({ id: pipeline.id, name: pipeline.name, isDefault: true });
    expect(response.json[0].stages[0]).toEqual({
      id: pipeline.stages[0].id,
      name: pipeline.stages[0].name,
      order: 0,
      type: "open",
    });
  });

  it("legt einen Lead ohne bestehenden Kontakt an — samt Kontakt, Firma und Mailwin-Ursprung", async () => {
    const { ctx, organization, key } = await workspace();
    const response = await call(postLeads, "POST", "/api/mailwin/v1/leads", { key, body: leadBody("erika@beispiel-ag.de") });

    expect(response.status).toBe(201);
    expect(response.json).toEqual({ id: expect.any(String), url: expect.stringContaining(`/deals/${response.json.id}`) });

    const pipeline = await defaultPipeline(ctx);
    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: response.json.id },
      include: { contacts: { include: { contact: true } }, company: true },
    });
    expect(deal).toMatchObject({
      organizationId: organization.id,
      name: "Anfrage Rahmenvertrag",
      description: "Kundin fragt nach einem Angebot für 50 Lizenzen.",
      pipelineId: pipeline.id,
      stageId: pipeline.stages[0].id,
      source: "mailwin",
      status: "OPEN",
    });
    expect(Number(deal.amount)).toBe(12500.5);
    expect(deal.sourceRef).toMatchObject({ system: "mailwin", channel: "email", messageId: "msg_456", url: "https://okun-mailwin.com/inbox/thr_123" });
    expect(deal.contacts).toHaveLength(1);
    expect(deal.contacts[0].contact).toMatchObject({ email: "erika@beispiel-ag.de", firstName: "Erika", lastName: "Musterfrau", source: "mailwin" });
    expect(deal.company?.name).toBe("Beispiel AG");

    const lookup = await call(getContacts, "GET", "/api/mailwin/v1/contacts?email=erika@beispiel-ag.de", { key });
    expect(lookup.json[0].openLeads).toEqual([
      expect.objectContaining({ id: deal.id, title: "Anfrage Rahmenvertrag", stage: pipeline.stages[0].name }),
    ]);
  });

  it("verwendet einen bestehenden Kontakt statt ihn neu anzulegen", async () => {
    const { ctx, organization, key } = await workspace();
    const existing = await createContact(ctx, { firstName: "Erika", lastName: "Gepflegt", email: "erika@beispiel-ag.de" });
    const response = await call(postLeads, "POST", "/api/mailwin/v1/leads", { key, body: leadBody("ERIKA@beispiel-ag.de") });
    expect(response.status).toBe(201);
    expect(await prisma.contact.count({ where: { organizationId: organization.id } })).toBe(1);
    const link = await prisma.dealContact.findFirstOrThrow({ where: { dealId: response.json.id } });
    expect(link.contactId).toBe(existing.id);
  });

  it("ist mit Idempotency-Key idempotent: dieselbe Antwort, kein zweiter Lead", async () => {
    const { organization, key } = await workspace();
    const headers = { "Idempotency-Key": "lead-msg_456" };

    const first = await call(postLeads, "POST", "/api/mailwin/v1/leads", { key, body: leadBody("ida@kunde.de"), headers });
    const second = await call(postLeads, "POST", "/api/mailwin/v1/leads", { key, body: leadBody("ida@kunde.de"), headers });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.json).toEqual(first.json);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await prisma.deal.count({ where: { organizationId: organization.id } })).toBe(1);

    const reused = await call(postLeads, "POST", "/api/mailwin/v1/leads", {
      key,
      body: leadBody("ida@kunde.de", { title: "Etwas anderes" }),
      headers,
    });
    expect(reused.status).toBe(422);
    expect(reused.json.error.code).toBe("idempotency_key_reused");
  });

  it("gibt einen Idempotency-Key nach einem abgelehnten Aufruf wieder frei", async () => {
    const { organization, key } = await workspace();
    const headers = { "Idempotency-Key": "retry-after-fix" };
    const invalid = await call(postLeads, "POST", "/api/mailwin/v1/leads", {
      key,
      body: leadBody("fix@kunde.de", { title: "" }),
      headers,
    });
    expect(invalid.status).toBe(422);
    const fixed = await call(postLeads, "POST", "/api/mailwin/v1/leads", { key, body: leadBody("fix@kunde.de"), headers });
    expect(fixed.status).toBe(201);
    expect(await prisma.deal.count({ where: { organizationId: organization.id } })).toBe(1);
  });

  it("meldet Validierungsfehler als 422 mit Feldpfaden und kaputtes JSON als 400", async () => {
    const { key } = await workspace();
    const invalid = await call(postLeads, "POST", "/api/mailwin/v1/leads", {
      key,
      body: leadBody("v@kunde.de", { source: "outlook", sourceRef: { channel: "fax", threadId: "t", messageId: "m", url: "javascript:alert(1)" } }),
    });
    expect(invalid.status).toBe(422);
    expect(invalid.json.error.code).toBe("validation_failed");
    expect(Object.keys(invalid.json.error.details.fields)).toEqual(
      expect.arrayContaining(["source", "sourceRef.channel", "sourceRef.url"]),
    );

    const broken = await call(postLeads, "POST", "/api/mailwin/v1/leads", { key, rawBody: "{kein json" });
    expect(broken.status).toBe(400);
    expect(broken.json.error.code).toBe("invalid_request");
  });

  it("nimmt Pipeline und Phase entgegen und prüft, dass sie zusammengehören", async () => {
    const { ctx, key } = await workspace();
    const pipeline = await defaultPipeline(ctx);
    const second = pipeline.stages[1];

    const ok = await call(postLeads, "POST", "/api/mailwin/v1/leads", { key, body: leadBody("p@kunde.de", { stageId: second.id }) });
    expect(ok.status).toBe(201);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: ok.json.id } })).stageId).toBe(second.id);

    const mismatch = await call(postLeads, "POST", "/api/mailwin/v1/leads", {
      key,
      body: leadBody("p@kunde.de", { pipelineId: "c_nicht_vorhanden", stageId: second.id }),
    });
    expect(mismatch.status).toBe(422);
  });
});

describe("Mailwin Connect API — Aktivitäten", () => {
  async function setup() {
    const ws = await workspace();
    const lead = await call(postLeads, "POST", "/api/mailwin/v1/leads", { key: ws.key, body: leadBody("akt@kunde.de") });
    const contact = await prisma.dealContact.findFirstOrThrow({ where: { dealId: lead.json.id } });
    return { ...ws, leadId: lead.json.id as string, contactId: contact.contactId };
  }

  const activity = (extra: Record<string, unknown>) => ({
    type: "whatsapp",
    direction: "inbound",
    summary: "Kundin bestätigt den Termin am Dienstag.",
    occurredAt: "2026-10-30T09:15:00+01:00",
    externalId: "wa_msg_1",
    url: "https://okun-mailwin.com/inbox/wa/1",
    ...extra,
  });

  it("protokolliert in der Zeitleiste von Kontakt und Lead, mit Quelle Mailwin", async () => {
    const { organization, key, leadId, contactId } = await setup();
    const response = await call(postActivities, "POST", "/api/mailwin/v1/activities", {
      key,
      body: activity({ contactId, leadId, subject: "Termin" }),
    });
    expect(response.status).toBe(201);
    expect(response.json).toEqual({ id: expect.any(String) });

    const stored = await prisma.activity.findUniqueOrThrow({ where: { id: response.json.id } });
    expect(stored).toMatchObject({
      organizationId: organization.id,
      type: "WHATSAPP",
      source: "MAILWIN",
      direction: "INBOUND",
      subject: "Termin",
      body: "Kundin bestätigt den Termin am Dienstag.",
      contactId,
      dealId: leadId,
      externalSource: "mailwin",
      externalId: "wa_msg_1",
    });
    expect(stored.occurredAt.toISOString()).toBe("2026-10-30T08:15:00.000Z");
    expect(stored.metadata).toMatchObject({ url: "https://okun-mailwin.com/inbox/wa/1" });

    // Eine eingehende Antwort zählt für das aktive CRM wie eine erfasste.
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: leadId } });
    expect(deal.lastCustomerResponseAt?.toISOString()).toBe("2026-10-30T08:15:00.000Z");
  });

  it("ist über externalId idempotent", async () => {
    const { organization, key, contactId } = await setup();
    const first = await call(postActivities, "POST", "/api/mailwin/v1/activities", { key, body: activity({ contactId }) });
    const second = await call(postActivities, "POST", "/api/mailwin/v1/activities", {
      key,
      body: activity({ contactId, summary: "Andere Zusammenfassung" }),
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.json.id).toBe(first.json.id);
    expect(
      await prisma.activity.count({ where: { organizationId: organization.id, externalSource: "mailwin" } }),
    ).toBe(1);

    // Mit Idempotency-Key kommt beim zweiten Mal exakt die erste Antwort zurück.
    const headers = { "Idempotency-Key": "act-2" };
    const a = await call(postActivities, "POST", "/api/mailwin/v1/activities", { key, body: activity({ contactId, externalId: "e2" }), headers });
    const b = await call(postActivities, "POST", "/api/mailwin/v1/activities", { key, body: activity({ contactId, externalId: "e2" }), headers });
    expect(b.status).toBe(a.status);
    expect(b.json).toEqual(a.json);
    expect(b.headers.get("Idempotent-Replayed")).toBe("true");
  });

  it("verlangt contactId oder leadId und einen Zeitpunkt mit Zeitzone", async () => {
    const { key } = await setup();
    const withoutLink = await call(postActivities, "POST", "/api/mailwin/v1/activities", { key, body: activity({}) });
    expect(withoutLink.status).toBe(422);
    expect(withoutLink.json.error.details.fields).toHaveProperty("contactId");

    const { contactId } = await setup();
    const withoutZone = await call(postActivities, "POST", "/api/mailwin/v1/activities", {
      key,
      body: activity({ contactId, occurredAt: "2026-10-30T09:15:00" }),
    });
    expect(withoutZone.status).toBe(422);
    expect(withoutZone.json.error.details.fields).toHaveProperty("occurredAt");
  });

  it("vermerkt Änderungen im Audit-Log mit Herkunft Mailwin", async () => {
    const { organization } = await setup();
    const entries = await prisma.auditLog.findMany({ where: { organizationId: organization.id, action: "deal.created" } });
    expect(entries).toHaveLength(1);
    expect(entries[0].origin).toBe("mailwin");
  });
});

describe("Webhooks an Mailwin", () => {
  let server: Server;
  let url: string;
  const received: { headers: IncomingMessage["headers"]; body: string; path: string }[] = [];
  let respondWith = 200;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push({ headers: req.headers, body, path: req.url ?? "" });
        res.statusCode = respondWith;
        res.end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    received.length = 0;
    respondWith = 200;
  });

  const SECRET = "mailwin-test-geheimnis-0123456789";

  it("meldet einen Phasenwechsel signiert als lead.stage_changed", async () => {
    const { ctx, organization, key } = await workspace();
    // Mailwin hängt seine Integrations-ID als Query-Parameter an; sie muss erhalten bleiben.
    await saveMailwinWebhook(ctx, { url: `${url}?i=int_42`, secret: SECRET, events: ["lead.stage_changed", "lead.won"], isActive: true });
    const lead = await call(postLeads, "POST", "/api/mailwin/v1/leads", { key, body: leadBody("hook@kunde.de") });
    const pipeline = await defaultPipeline(ctx);

    await changeDealStage(ctx, lead.json.id, { stageId: pipeline.stages[1].id });
    await processDueWebhookDeliveries();

    expect(received).toHaveLength(1);
    const [{ headers, body, path }] = received;
    expect(path).toBe("/webhook?i=int_42");
    expect(headers["x-okun-workspace"]).toBe(organization.id);
    const timestamp = String(headers["x-okun-timestamp"]);
    const expected = `sha256=${createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex")}`;
    expect(headers["x-okun-signature"]).toBe(expected);
    expect(headers["x-okun-event"]).toBe("lead.stage_changed");

    const envelope = JSON.parse(body);
    expect(Object.keys(envelope).sort()).toEqual(["data", "id", "occurredAt", "type", "workspaceId"]);
    expect(envelope.type).toBe("lead.stage_changed");
    expect(envelope.workspaceId).toBe(organization.id);
    expect(envelope.data.lead).toMatchObject({
      id: lead.json.id,
      stage: { id: pipeline.stages[1].id, name: pipeline.stages[1].name },
      status: "open",
      valueCents: 1_250_050,
      sourceRef: { messageId: "msg_456" },
    });
    expect(envelope.data.previousStage).toMatchObject({ id: pipeline.stages[0].id });
  });

  it("schickt Änderungen, die Mailwin selbst ausgelöst hat, nicht zurück", async () => {
    const { ctx, organization, key } = await workspace();
    await saveMailwinWebhook(ctx, { url, secret: SECRET, events: ["contact.updated"], isActive: true });
    await call(postContacts, "POST", "/api/mailwin/v1/contacts", { key, body: { email: "echo@kunde.de" } });
    await call(postContacts, "POST", "/api/mailwin/v1/contacts", { key, body: { email: "echo@kunde.de", phone: "123" } });
    expect(await prisma.webhookDelivery.count({ where: { organizationId: organization.id } })).toBe(0);
  });

  it("wiederholt fehlgeschlagene Zustellungen mit wachsendem Abstand, höchstens 24 Stunden", async () => {
    const { ctx, organization, key } = await workspace();
    await saveMailwinWebhook(ctx, { url, secret: SECRET, events: ["lead.won"], isActive: true });
    const lead = await call(postLeads, "POST", "/api/mailwin/v1/leads", { key, body: leadBody("retry@kunde.de") });
    const pipeline = await defaultPipeline(ctx);
    const won = pipeline.stages.find((stage) => stage.type === "WON")!;

    respondWith = 503;
    await changeDealStage(ctx, lead.json.id, { stageId: won.id });
    await processDueWebhookDeliveries();

    const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { organizationId: organization.id } });
    expect(delivery).toMatchObject({ status: "PENDING", attempts: 1, responseStatus: 503 });
    expect(delivery.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());

    const created = new Date("2026-10-30T00:00:00Z");
    const at = (hours: number) => new Date(created.getTime() + hours * 3_600_000);
    const first = nextAttemptAt("MAILWIN", 1, created, created)!;
    const later = nextAttemptAt("MAILWIN", 6, created, created)!;
    expect(later.getTime() - created.getTime()).toBeGreaterThan(first.getTime() - created.getTime());
    expect(nextAttemptAt("MAILWIN", 12, created, at(23.5))!.getTime()).toBe(at(24).getTime());
    expect(nextAttemptAt("MAILWIN", 13, created, at(24))).toBeNull();
  });
});

describe("OpenAPI", () => {
  it("liefert die Spezifikation öffentlich und deckungsgleich mit der Datei im Repository", async () => {
    const response = await getOpenApi();
    expect(response.status).toBe(200);
    const spec = await response.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(["/me", "/contacts", "/pipelines", "/leads", "/activities"]),
    );
    const { readFileSync } = await import("node:fs");
    const file = JSON.parse(readFileSync("docs/mailwin/openapi.json", "utf-8"));
    // Weicht die Datei ab: `pnpm mailwin:openapi` ausführen.
    expect(file).toEqual(spec);
  });
});
