import { MAILWIN_API_BASE_PATH } from "@/lib/crm/mailwin";

/**
 * OpenAPI-3.1-Beschreibung der Mailwin Connect API v1.
 *
 * Ausgeliefert unter `/api/mailwin/v1/openapi.json` und als Datei unter
 * `docs/mailwin/openapi.json` (`pnpm mailwin:openapi`). Ein Test hält beide
 * deckungsgleich. Die Server-URL ist relativ, damit dieselbe Datei für jede
 * Instanz (Produktion, Test, lokal) stimmt.
 */
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown, example?: unknown) => ({
  "application/json": { schema, ...(example !== undefined ? { example } : {}) },
});
const errorResponse = (description: string, example: { code: string; message: string }) => ({
  description,
  content: json(ref("Error"), { error: example }),
});

const common = {
  "401": errorResponse("Schlüssel fehlt, ist ungültig oder widerrufen.", {
    code: "unauthorized",
    message: "Der API-Schlüssel fehlt, ist ungültig oder wurde widerrufen.",
  }),
  "403": errorResponse("Schlüssel ohne Mailwin-Freigabe oder Arbeitsbereich gesperrt.", {
    code: "forbidden",
    message: "Dieser API-Schlüssel ist nicht für die Mailwin Connect API freigegeben.",
  }),
  "429": {
    description: "Mehr als 120 Anfragen pro Minute und Schlüssel.",
    headers: { "Retry-After": { description: "Sekunden bis zur nächsten erlaubten Anfrage.", schema: { type: "integer" } } },
    content: json(ref("Error"), { error: { code: "rate_limited", message: "Zu viele Anfragen: höchstens 120 pro Minute und Schlüssel." } }),
  },
};

const writeErrors = {
  "400": errorResponse("Kein gültiges JSON oder ungültiger Idempotency-Key.", {
    code: "invalid_request",
    message: "Der Request-Body ist kein gültiges JSON.",
  }),
  "409": errorResponse("Eine Anfrage mit demselben Idempotency-Key läuft noch.", {
    code: "idempotency_key_in_use",
    message: "Eine Anfrage mit diesem Idempotency-Key wird gerade verarbeitet. Bitte kurz darauf wiederholen.",
  }),
  "422": {
    description: "Validierungsfehler — oder ein Idempotency-Key, der schon für eine andere Anfrage verwendet wurde.",
    content: json(ref("Error"), {
      error: {
        code: "validation_failed",
        message: "Die übermittelten Daten sind ungültig.",
        details: { fields: { "contact.email": "Bitte eine gültige E-Mail-Adresse angeben." } },
      },
    }),
  },
};

const idParam = (description: string) => ({
  name: "id",
  in: "path",
  required: true,
  description,
  schema: { type: "string" },
});

const idempotencyHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  description:
    "Frei wählbarer Schlüssel (1–255 sichtbare ASCII-Zeichen). Dieselbe Anfrage mit demselben Schlüssel liefert 24 Stunden lang dieselbe Antwort und legt nichts doppelt an. Nur erfolgreiche Antworten werden gespeichert.",
  schema: { type: "string", maxLength: 255 },
};

const contactExample = {
  id: "cmd2contact0001",
  name: "Erika Musterfrau",
  email: "erika@beispiel-ag.de",
  phone: "+49 30 1234567",
  company: { id: "cmd2company0001", name: "Beispiel AG", domain: "beispiel-ag.de" },
  openLeads: [
    {
      id: "cmd2deal0001",
      title: "Anfrage Rahmenvertrag",
      stage: "Qualifiziert",
      stageId: "cmd2stage0002",
      pipelineId: "cmd2pipeline01",
      url: "https://crm.example.com/deals/cmd2deal0001",
    },
  ],
  url: "https://crm.example.com/contacts/cmd2contact0001",
};

export function mailwinOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "OKUN CRM — Mailwin Connect API",
      version: "1.3.0",
      description: [
        "Schnittstelle, über die OKUN Mailwin Kontakte nachschlägt, Leads anlegt und Nachrichten protokolliert.",
        "",
        "**Begriffe:** Ein Mailwin-„Lead“ ist im CRM ein Deal (Pipeline, Phase, Wert, gewonnen/verloren).",
        "",
        "**Zeitstempel** sind ISO 8601 mit Zeitzone; Antworten verwenden UTC (`Z`).",
        "",
        "**Rate-Limit:** 120 Anfragen pro Minute und Schlüssel. Jede Antwort trägt `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.",
        "",
        "**Webhooks** an Mailwin: `POST` mit `{ id, type, occurredAt, workspaceId, data }` (siehe Abschnitt `webhooks`). Header `X-Okun-Event`, `X-Okun-Workspace`, `X-Okun-Delivery`, `X-Okun-Timestamp` (Unix-Sekunden) und `X-Okun-Signature: sha256=<hex HMAC-SHA256 über \"<timestamp>.<rohbody>\">`. Query-Parameter der Zieladresse bleiben erhalten. Zustellung mindestens einmal — Duplikate über `id` erkennen.",
      ].join("\n"),
    },
    servers: [{ url: MAILWIN_API_BASE_PATH, description: "Relativ zur Adresse der CRM-Instanz, z. B. https://crm.example.com" }],
    security: [{ apiKey: [] }],
    tags: [
      { name: "Zugang" },
      { name: "Kontakte" },
      { name: "Leads" },
      { name: "Aktivitäten" },
      { name: "Signale (v1.2)" },
      { name: "Akquise (v1.2)" },
    ],
    paths: {
      "/me": {
        get: {
          tags: ["Zugang"],
          operationId: "getMe",
          summary: "Schlüssel prüfen",
          description: "Nennt den Arbeitsbereich, zu dem der Schlüssel gehört.",
          responses: {
            "200": {
              description: "Arbeitsbereich",
              content: json(ref("Workspace"), {
                workspaceId: "cmd2org000001",
                name: "Beispiel AG",
                appUrl: "https://crm.example.com",
              }),
            },
            ...common,
          },
        },
      },
      "/contacts": {
        get: {
          tags: ["Kontakte"],
          operationId: "findContacts",
          summary: "Kontakte zu einer E-Mail-Adresse",
          description: "Groß-/Kleinschreibung egal. Mehrere Treffer sind möglich (älteste zuerst, höchstens 20).",
          parameters: [{ name: "email", in: "query", required: true, schema: { type: "string", format: "email" } }],
          responses: {
            "200": { description: "Treffer (leer, wenn keiner)", content: json({ type: "array", items: ref("Contact") }, [contactExample]) },
            "400": errorResponse("`email` fehlt oder ist ungültig.", {
              code: "invalid_request",
              message: "Der Parameter „email“ fehlt oder ist keine gültige E-Mail-Adresse.",
            }),
            ...common,
          },
        },
        post: {
          tags: ["Kontakte"],
          operationId: "upsertContact",
          summary: "Kontakt anlegen oder ergänzen",
          description:
            "Abgleich über die E-Mail-Adresse. Ein bestehender Kontakt wird nur ergänzt: leere Felder (Telefon, Firma) werden gefüllt, ein Platzhaltername ersetzt; gepflegte Daten werden nie überschrieben. Firma über Domain, sonst Namen zuordnen, sonst anlegen. Freemail-Domains (gmail.com, web.de …) werden ignoriert.",
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: json(ref("ContactUpsert"), {
              email: "erika@beispiel-ag.de",
              name: "Erika Musterfrau",
              phone: "+49 30 1234567",
              companyName: "Beispiel AG",
              companyDomain: "beispiel-ag.de",
            }),
          },
          responses: {
            "201": { description: "Neu angelegt", content: json(ref("Contact"), { ...contactExample, openLeads: [] }) },
            "200": { description: "Bestehender Kontakt (ggf. ergänzt)", content: json(ref("Contact"), contactExample) },
            ...writeErrors,
            ...common,
          },
        },
      },
      "/pipelines": {
        get: {
          tags: ["Leads"],
          operationId: "listPipelines",
          summary: "Pipelines und Phasen",
          description: "Aktive Pipelines; die Standard-Pipeline steht zuerst. `order` beginnt bei 0.",
          responses: {
            "200": {
              description: "Pipelines",
              content: json({ type: "array", items: ref("Pipeline") }, [
                {
                  id: "cmd2pipeline01",
                  name: "Vertrieb",
                  isDefault: true,
                  stages: [
                    { id: "cmd2stage0001", name: "Neu", order: 0, type: "open" },
                    { id: "cmd2stage0002", name: "Qualifiziert", order: 1, type: "open" },
                    { id: "cmd2stage0009", name: "Gewonnen", order: 5, type: "won" },
                  ],
                },
              ]),
            },
            ...common,
          },
        },
      },
      "/leads": {
        post: {
          tags: ["Leads"],
          operationId: "createLead",
          summary: "Lead anlegen",
          description:
            "Legt im CRM einen Deal an. Ohne `pipelineId`/`stageId` gilt die Standard-Pipeline mit ihrer ersten offenen Phase; `stageId` allein bestimmt auch die Pipeline. Fehlt der Kontakt, wird er angelegt (wie `POST /contacts`). `sourceRef.url` erscheint am Lead als „In Mailwin öffnen“.",
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: json(ref("LeadCreate"), {
              contact: { email: "erika@beispiel-ag.de", name: "Erika Musterfrau" },
              companyName: "Beispiel AG",
              title: "Anfrage Rahmenvertrag",
              description: "Kundin fragt nach einem Angebot für 50 Lizenzen.",
              valueCents: 1250000,
              source: "mailwin",
              sourceRef: {
                channel: "email",
                threadId: "7d1f3c2a-5b8e-4f6a-9c0d-2e4b6a8c1f30",
                messageId: "c41e9a07-2f3d-4b6e-8a15-9d0c7b3e2f18",
                url: "https://okun-mailwin.com/emails/7d1f3c2a-5b8e-4f6a-9c0d-2e4b6a8c1f30",
              },
            }),
          },
          responses: {
            "201": {
              description: "Angelegt",
              content: json(ref("LeadCreated"), { id: "cmd2deal0001", url: "https://crm.example.com/deals/cmd2deal0001" }),
            },
            ...writeErrors,
            ...common,
          },
        },
      },
      "/activities": {
        post: {
          tags: ["Aktivitäten"],
          operationId: "createActivity",
          summary: "Nachricht protokollieren",
          description:
            "Erscheint in der Zeitleiste von Kontakt und/oder Lead. Über `externalId` idempotent: Eine bereits gemeldete Nachricht liefert 200 mit der bestehenden `id`. Eine eingehende Nachricht zu einem Lead zählt im aktiven CRM als Antwort des Kunden.",
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: json(ref("ActivityCreate"), {
              contactId: "cmd2contact0001",
              leadId: "cmd2deal0001",
              type: "email",
              direction: "inbound",
              subject: "Re: Angebot",
              summary: "Kundin bittet um eine Staffelung ab 100 Lizenzen.",
              occurredAt: "2026-10-30T09:15:00+01:00",
              externalId: "email:e8b2d6f4-1a3c-4e5f-9b7d-0c2a4e6f8b13",
              url: "https://okun-mailwin.com/emails/7d1f3c2a-5b8e-4f6a-9c0d-2e4b6a8c1f30#m-e8b2d6f4-1a3c-4e5f-9b7d-0c2a4e6f8b13",
            }),
          },
          responses: {
            "201": { description: "Neu protokolliert", content: json(ref("ActivityCreated"), { id: "cmd2activity01" }) },
            "200": { description: "Bereits protokolliert (gleiche externalId)", content: json(ref("ActivityCreated"), { id: "cmd2activity01" }) },
            "404": errorResponse("Kontakt oder Lead existiert nicht (in diesem Arbeitsbereich).", {
              code: "not_found",
              message: "Der Kontakt wurde nicht gefunden.",
            }),
            ...writeErrors,
            ...common,
          },
        },
      },
      "/leads/{id}": {
        get: {
          tags: ["Leads"],
          operationId: "getLead",
          summary: "Kontext zu einem Lead (v1.2)",
          description: "Für Antwortentwürfe: Phase, Wert, Kontakte, nächste Aktion, offene Aufgaben, letzte Nachrichten (ohne Systemereignisse), offene Vorschläge.",
          parameters: [idParam("Lead-ID (im CRM: Deal)")],
          responses: {
            "200": { description: "Lead", content: json(ref("LeadContext")) },
            "404": errorResponse("Lead existiert nicht (in diesem Arbeitsbereich).", { code: "not_found", message: "Der Lead wurde nicht gefunden." }),
            ...common,
          },
        },
      },
      "/leads/{id}/signals": {
        post: {
          tags: ["Signale (v1.2)"],
          operationId: "postSignal",
          summary: "Erkanntes Ereignis zu einem Lead melden (v1.2)",
          description: [
            "Mailwin meldet, was es erkannt hat; das CRM entscheidet nach den Einstellungen des Arbeitsbereichs, was folgt.",
            "",
            "| signal | Folge (Standard) |",
            "| --- | --- |",
            "| `offer_sent` | Phase → Angebot (nur vorwärts), „Angebot nachfassen“ geplant. `data.valueCents` füllt einen leeren Wert; ein abweichender wird zum Vorschlag „Wert auf … aktualisieren?“ — nie still überschrieben |",
            "| `offer_accepted` / `contract_accepted` | Vorschlag „Als gewonnen markieren?“ (automatisch gewonnen nur, wenn so eingestellt, `evidence.confidence` reicht **und** `evidence.quote` vorliegt) |",
            "| `offer_declined` | Vorschlag „Als verloren markieren?“ mit `data.reason` (automatisch wie oben) |",
            "| `meeting_booked` | Termin im Kalender (`data.startAt`), Phase → Termin |",
            "| `meeting_requested` | nächste Aktion „Termin vereinbaren“ |",
            "| `question` | nächste Aktion „Rückfrage beantworten“ |",
            "| `out_of_office` | Automationen pausieren bis `data.until` (sonst 7 Tage) — keine Kundenantwort |",
            "| `contract_sent` | Phase → Verhandlung |",
            "",
            "Phasen gehen nur vorwärts; ein gewonnener oder verlorener Lead wird nur protokolliert. Idempotent über `signal` + `externalId` (200 mit `duplicate: true`).",
          ].join("\n"),
          parameters: [idParam("Lead-ID (im CRM: Deal)"), idempotencyHeader],
          requestBody: {
            required: true,
            content: json(ref("SignalCreate"), {
              signal: "offer_sent",
              occurredAt: "2026-11-03T10:12:00+01:00",
              externalId: "email:a5c7e9b1-3d5f-4a7c-8e0b-2d4f6a8c0e25",
              url: "https://okun-mailwin.com/emails/7d1f3c2a-5b8e-4f6a-9c0d-2e4b6a8c1f30#m-a5c7e9b1-3d5f-4a7c-8e0b-2d4f6a8c0e25",
              summary: "Angebot Nr. 2026-117 über 24.000 € als PDF verschickt.",
              evidence: { quote: "anbei unser Angebot für die Wartung …", confidence: 0.93 },
              data: { offerNumber: "2026-117", valueCents: 2400000 },
            }),
          },
          responses: {
            "201": {
              description: "Verarbeitet",
              content: json(ref("SignalOutcome"), {
                signal: "offer_sent",
                duplicate: false,
                applied: ["timeline", "stage_changed:Angebot", "value_updated", "offer_follow_up"],
                proposed: [],
                ignored: [],
                lead: {
                  id: "cmd2deal0001",
                  url: "https://crm.example.com/deals/cmd2deal0001",
                  status: "open",
                  stage: { id: "cmd2stage0004", name: "Angebot" },
                  valueCents: 2400000,
                  nextAction: { type: "chase_offer", title: "Angebot nachfassen", dueAt: "2026-11-10T09:12:00.000Z" },
                  operationalState: "waiting_for_customer",
                },
              }),
            },
            "200": { description: "Bereits verarbeitet (gleiches signal + externalId)", content: json(ref("SignalOutcome")) },
            "404": errorResponse("Lead existiert nicht (in diesem Arbeitsbereich).", { code: "not_found", message: "Der Lead wurde nicht gefunden." }),
            ...writeErrors,
            ...common,
          },
        },
      },
      "/tasks": {
        post: {
          tags: ["Aktivitäten"],
          operationId: "createTask",
          summary: "Aufgabe anlegen (v1.2)",
          description:
            "Für die Person, die den Lead (sonst den Kontakt) betreut. `url` wird in die Beschreibung übernommen. Mit `externalId` dauerhaft idempotent: Dieselbe Kennung liefert 200 mit der bestehenden Aufgabe.",
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: json(ref("TaskCreate"), {
              title: "Kundin am Dienstag anrufen",
              dueAt: "2026-11-04T09:00:00+01:00",
              priority: "high",
              leadId: "cmd2deal0001",
              url: "https://okun-mailwin.com/emails/7d1f3c2a-5b8e-4f6a-9c0d-2e4b6a8c1f30#m-b6d8f0a2-4e6a-4b8d-9f1c-3e5a7b9d1f37",
              externalId: "task:b6d8f0a2-4e6a-4b8d-9f1c-3e5a7b9d1f37",
            }),
          },
          responses: {
            "201": {
              description: "Angelegt",
              content: json(ref("TaskCreated"), { id: "cmd2task0001", url: "https://crm.example.com/deals/cmd2deal0001", duplicate: false }),
            },
            "200": {
              description: "Bereits angelegt (gleiche externalId)",
              content: json(ref("TaskCreated"), { id: "cmd2task0001", url: "https://crm.example.com/deals/cmd2deal0001", duplicate: true }),
            },
            "404": errorResponse("Kontakt oder Lead existiert nicht.", { code: "not_found", message: "Der Lead wurde nicht gefunden." }),
            ...writeErrors,
            ...common,
          },
        },
      },
      "/contacts/{id}/suggestions": {
        post: {
          tags: ["Kontakte"],
          operationId: "suggestContactChanges",
          summary: "Kontaktdaten vorschlagen (v1.2)",
          description:
            "Leere Felder werden direkt gefüllt; wo im CRM schon etwas anderes steht, entsteht ein Vorschlag zur Übernahme. Ein gleicher offener Vorschlag wird nicht doppelt angelegt. `externalId` kommt in `signal.proposal_resolved` zurück.",
          parameters: [idParam("Kontakt-ID"), idempotencyHeader],
          requestBody: {
            required: true,
            content: json(ref("ContactSuggestion"), {
              fields: { phone: "+49 30 999", jobTitle: "Leitung Einkauf" },
              evidence: { quote: "Paul Pflege · Leitung Einkauf · +49 30 999", confidence: 0.9 },
              url: "https://okun-mailwin.com/emails/7d1f3c2a-5b8e-4f6a-9c0d-2e4b6a8c1f30#m-b6d8f0a2-4e6a-4b8d-9f1c-3e5a7b9d1f37",
              externalId: "signature:b6d8f0a2-4e6a-4b8d-9f1c-3e5a7b9d1f37",
            }),
          },
          responses: {
            "200": {
              description: "Verarbeitet",
              content: json(ref("ContactSuggestionResult"), {
                applied: ["phone"],
                proposed: { id: "cmd2sugg0001", fields: ["jobTitle"] },
                contact: { ...contactExample, phone: "+49 30 999" },
              }),
            },
            "404": errorResponse("Kontakt existiert nicht.", { code: "not_found", message: "Der Kontakt wurde nicht gefunden." }),
            ...writeErrors,
            ...common,
          },
        },
      },
      "/outreach/replies": {
        post: {
          tags: ["Akquise (v1.2)"],
          operationId: "recordOutreachReply",
          summary: "Antwort auf eine Akquise-Sequenz einstufen (v1.2)",
          description:
            "Mailwins Einstufung ersetzt die Schlüsselwort-Regel des CRM. Folgen wie bei der eigenen Einstufung: Sequenz anhalten, Prospect umstufen, Abmeldung auf die Sperrliste — eine Abwesenheitsnotiz hält nichts an. Zuordnung über `prospectId`, sonst über `inReplyTo`/`references` (Message-IDs der versendeten Sequenz-Mails, mit oder ohne `<>`), sonst über die Absenderadresse; `matchedBy` nennt den Weg. Idempotent über `messageId`.",
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: json(ref("OutreachReply"), {
              messageId: "msg_reply_77",
              fromAddress: "info@kalt-ag.de",
              subject: "Re: Kurze Frage",
              body: "Gerne, schicken Sie mir Unterlagen.",
              receivedAt: "2026-11-03T11:00:00+01:00",
              classification: "interested",
              confidence: 0.86,
              inReplyTo: "<seq-4711@crm.example.com>",
              references: ["<seq-4711@crm.example.com>"],
            }),
          },
          responses: {
            "201": {
              description: "Verarbeitet",
              content: json(ref("OutreachReplyResult"), {
                messageId: "cmd2mail0001",
                prospectId: "cmd2pros0001",
                classification: "interested",
                duplicate: false,
                matchedBy: "message_id",
              }),
            },
            "200": { description: "Bereits verarbeitet (gleiche messageId)", content: json(ref("OutreachReplyResult")) },
            "404": errorResponse("Prospect existiert nicht.", { code: "not_found", message: "Der Prospect wurde nicht gefunden." }),
            ...writeErrors,
            ...common,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: "Mailwin-Schlüssel aus Einstellungen → Integrationen → Mailwin (`okun_mw_…`).",
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: {
                  type: "string",
                  enum: [
                    "invalid_request",
                    "unauthorized",
                    "forbidden",
                    "not_found",
                    "conflict",
                    "idempotency_key_in_use",
                    "idempotency_key_reused",
                    "validation_failed",
                    "payload_too_large",
                    "rate_limited",
                    "internal_error",
                  ],
                },
                message: { type: "string" },
                details: {
                  type: "object",
                  properties: { fields: { type: "object", additionalProperties: { type: "string" } } },
                },
              },
            },
          },
        },
        Workspace: {
          type: "object",
          required: ["workspaceId", "name", "appUrl"],
          properties: { workspaceId: { type: "string" }, name: { type: "string" }, appUrl: { type: "string", format: "uri" } },
        },
        CompanyRef: {
          type: "object",
          required: ["id", "name", "domain"],
          properties: { id: { type: "string" }, name: { type: "string" }, domain: { type: ["string", "null"] } },
        },
        OpenLead: {
          type: "object",
          required: ["id", "title", "stage", "stageId", "pipelineId", "url"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            stage: { type: "string", description: "Name der Phase" },
            stageId: { type: "string" },
            pipelineId: { type: "string" },
            url: { type: "string", format: "uri" },
          },
        },
        Contact: {
          type: "object",
          required: ["id", "name", "email", "phone", "company", "openLeads", "url"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            email: { type: ["string", "null"] },
            phone: { type: ["string", "null"] },
            company: { oneOf: [ref("CompanyRef"), { type: "null" }] },
            openLeads: { type: "array", items: ref("OpenLead") },
            url: { type: "string", format: "uri", description: "Direktlink in die CRM-Oberfläche" },
          },
        },
        ContactUpsert: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email" },
            name: { type: "string", maxLength: 160 },
            phone: { type: "string", maxLength: 40 },
            companyName: { type: "string", maxLength: 160 },
            companyDomain: { type: "string", maxLength: 160 },
          },
        },
        Stage: {
          type: "object",
          required: ["id", "name", "order", "type"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            order: { type: "integer", minimum: 0 },
            type: { type: "string", enum: ["open", "won", "lost"] },
          },
        },
        Pipeline: {
          type: "object",
          required: ["id", "name", "isDefault", "stages"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            isDefault: { type: "boolean" },
            stages: { type: "array", items: ref("Stage") },
          },
        },
        SourceRef: {
          type: "object",
          required: ["channel", "threadId", "messageId", "url"],
          properties: {
            channel: { type: "string", enum: ["email", "whatsapp"] },
            threadId: { type: "string", maxLength: 500 },
            messageId: { type: "string", maxLength: 500 },
            url: { type: "string", format: "uri", description: "http(s); wird als „In Mailwin öffnen“ verlinkt" },
          },
        },
        LeadCreate: {
          type: "object",
          required: ["contact", "title", "description", "source", "sourceRef"],
          properties: {
            contact: {
              type: "object",
              required: ["email"],
              properties: { email: { type: "string", format: "email" }, name: { type: "string", maxLength: 160 } },
            },
            companyName: { type: "string", maxLength: 160 },
            title: { type: "string", minLength: 1, maxLength: 160 },
            description: { type: "string", maxLength: 10000 },
            pipelineId: { type: "string" },
            stageId: { type: "string" },
            valueCents: { type: "integer", minimum: 0 },
            source: { type: "string", const: "mailwin" },
            sourceRef: ref("SourceRef"),
          },
        },
        LeadCreated: {
          type: "object",
          required: ["id", "url"],
          properties: { id: { type: "string" }, url: { type: "string", format: "uri" } },
        },
        ActivityCreate: {
          type: "object",
          required: ["type", "direction", "summary", "occurredAt", "externalId", "url"],
          description: "Mindestens `contactId` oder `leadId` ist Pflicht.",
          properties: {
            contactId: { type: "string" },
            leadId: { type: "string" },
            type: { type: "string", enum: ["email", "whatsapp", "note"] },
            direction: { type: "string", enum: ["inbound", "outbound"] },
            subject: { type: "string", maxLength: 200 },
            summary: { type: "string", minLength: 1, maxLength: 10000 },
            occurredAt: { type: "string", format: "date-time", description: "ISO 8601 mit Zeitzone" },
            externalId: { type: "string", maxLength: 200 },
            url: { type: "string", format: "uri" },
          },
        },
        ActivityCreated: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        Created: {
          type: "object",
          required: ["id", "url"],
          properties: { id: { type: "string" }, url: { type: "string", format: "uri" } },
        },
        Evidence: {
          type: "object",
          properties: {
            quote: { type: "string", maxLength: 300, description: "Wörtliches Zitat aus der Nachricht als Beleg; wird im CRM angezeigt" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        SignalCreate: {
          type: "object",
          required: ["signal", "occurredAt", "externalId"],
          properties: {
            signal: {
              type: "string",
              enum: [
                "offer_sent",
                "offer_accepted",
                "offer_declined",
                "meeting_requested",
                "meeting_booked",
                "question",
                "out_of_office",
                "contract_sent",
                "contract_accepted",
              ],
            },
            occurredAt: { type: "string", format: "date-time", description: "ISO 8601 mit Zeitzone" },
            externalId: { type: "string", maxLength: 200, description: "Nachrichten-ID; mit `signal` zusammen eindeutig" },
            url: { type: "string", format: "uri" },
            summary: { type: "string", maxLength: 2000 },
            evidence: ref("Evidence"),
            data: {
              type: "object",
              properties: {
                valueCents: { type: "integer", minimum: 0, description: "offer_sent: Angebotswert" },
                offerNumber: { type: "string" },
                validUntil: { type: "string" },
                startAt: { type: "string", format: "date-time", description: "meeting_booked" },
                endAt: { type: "string", format: "date-time", description: "meeting_booked; sonst Beginn + 60 min" },
                title: { type: "string", description: "meeting_booked: Titel des Termins" },
                location: { type: "string" },
                until: { type: "string", format: "date-time", description: "out_of_office: Rückkehr" },
                reason: { type: "string", description: "offer_declined: Grund" },
              },
            },
          },
        },
        SignalOutcome: {
          type: "object",
          required: ["signal", "duplicate", "applied", "proposed", "ignored", "lead"],
          properties: {
            signal: { type: "string" },
            duplicate: { type: "boolean" },
            applied: {
              type: "array",
              items: { type: "string" },
              description:
                "timeline, stage_changed:<Phase>, value_updated, offer_follow_up, meeting_created, next_action_set, automation_paused, won, lost",
            },
            proposed: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "kind", "title"],
                properties: {
                  id: { type: "string", description: "Kommt als `proposalId` in `signal.proposal_resolved` zurück" },
                  kind: { type: "string", enum: ["deal.mark_won", "deal.mark_lost", "deal.update_value"] },
                  title: { type: "string" },
                },
              },
            },
            ignored: { type: "array", items: { type: "string" }, description: "Was bewusst nicht geschah, als `code: Erklärung`" },
            lead: {
              type: "object",
              properties: {
                id: { type: "string" },
                url: { type: "string", format: "uri" },
                status: { type: "string", enum: ["open", "won", "lost"] },
                stage: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
                valueCents: { type: "integer" },
                nextAction: { oneOf: [ref("NextActionRef"), { type: "null" }] },
                operationalState: { type: "string" },
              },
            },
          },
        },
        LeadContext: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            url: { type: "string", format: "uri" },
            status: { type: "string", enum: ["open", "won", "lost"] },
            description: { type: ["string", "null"] },
            pipeline: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
            stage: ref("Stage"),
            valueCents: { type: "integer" },
            currency: { type: "string" },
            expectedCloseDate: { type: ["string", "null"], format: "date-time" },
            owner: { type: ["object", "null"], properties: { name: { type: "string" }, email: { type: "string" } } },
            company: { oneOf: [ref("CompanyRef"), { type: "null" }] },
            contacts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  email: { type: ["string", "null"] },
                  phone: { type: ["string", "null"] },
                  isPrimary: { type: "boolean" },
                  url: { type: "string", format: "uri" },
                },
              },
            },
            operationalState: { type: "string", description: "waiting_for_us, waiting_for_customer, scheduled, no_next_action, closed …" },
            nextAction: { oneOf: [ref("NextActionRef"), { type: "null" }] },
            offerSentAt: { type: ["string", "null"], format: "date-time" },
            lastCustomerResponseAt: { type: ["string", "null"], format: "date-time" },
            lastOutboundAt: { type: ["string", "null"], format: "date-time" },
            nextMeetingAt: { type: ["string", "null"], format: "date-time" },
            automationPausedUntil: { type: ["string", "null"], format: "date-time" },
            openTasks: {
              type: "array",
              items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, dueAt: { type: ["string", "null"] }, priority: { type: "string" } } },
            },
            recentActivities: {
              type: "array",
              maxItems: 5,
              description: "Die letzten fünf Aktivitäten, neueste zuerst",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  type: { type: "string" },
                  direction: { type: ["string", "null"] },
                  subject: { type: ["string", "null"] },
                  summary: { type: ["string", "null"] },
                  occurredAt: { type: "string", format: "date-time" },
                  viaMailwin: { type: "boolean" },
                },
              },
            },
            pendingSuggestions: {
              type: "array",
              items: { type: "object", properties: { id: { type: "string" }, kind: { type: "string" }, title: { type: "string" } } },
            },
            sourceRef: { type: ["object", "null"] },
          },
        },
        TaskCreate: {
          type: "object",
          required: ["title"],
          description: "Mindestens `contactId` oder `leadId` ist Pflicht.",
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: "string", maxLength: 5000 },
            dueAt: { type: "string", format: "date-time", description: "ISO 8601 mit Zeitzone" },
            priority: { type: "string", enum: ["low", "medium", "high", "urgent"], default: "medium" },
            contactId: { type: "string" },
            leadId: { type: "string" },
            url: { type: "string", format: "uri" },
            externalId: { type: "string", maxLength: 200, description: "Dauerhaft eindeutig je Arbeitsbereich, z. B. `task:<messageId>`" },
          },
        },
        TaskCreated: {
          type: "object",
          required: ["id", "url", "duplicate"],
          properties: { id: { type: "string" }, url: { type: "string", format: "uri" }, duplicate: { type: "boolean" } },
        },
        NextActionRef: {
          type: "object",
          required: ["type", "title", "dueAt"],
          properties: {
            type: {
              type: "string",
              description:
                "contact_lead, qualify_lead, follow_up, call, schedule_meeting, confirm_meeting, prepare_meeting, create_offer, send_offer, chase_offer, get_decision, prepare_contract, reactivate, define_next_step, custom",
            },
            title: { type: "string" },
            dueAt: { type: ["string", "null"], format: "date-time" },
          },
        },
        ContactSuggestion: {
          type: "object",
          required: ["fields"],
          properties: {
            fields: {
              type: "object",
              minProperties: 1,
              properties: {
                name: { type: "string", maxLength: 160 },
                phone: { type: "string", maxLength: 40 },
                mobile: { type: "string", maxLength: 40 },
                jobTitle: { type: "string", maxLength: 120 },
                linkedinUrl: { type: "string", format: "uri" },
                street: { type: "string", maxLength: 200 },
                postalCode: { type: "string", maxLength: 20 },
                city: { type: "string", maxLength: 120 },
                country: { type: "string", maxLength: 80 },
              },
            },
            evidence: ref("Evidence"),
            url: { type: "string", format: "uri" },
            externalId: { type: "string", maxLength: 200 },
          },
        },
        ContactSuggestionResult: {
          type: "object",
          required: ["applied", "proposed", "contact"],
          properties: {
            applied: { type: "array", items: { type: "string" }, description: "Direkt gefüllte Felder" },
            proposed: {
              oneOf: [
                { type: "object", properties: { id: { type: "string" }, fields: { type: "array", items: { type: "string" } } } },
                { type: "null" },
              ],
            },
            contact: ref("Contact"),
          },
        },
        OutreachReply: {
          type: "object",
          required: ["messageId", "fromAddress", "body", "receivedAt", "classification", "confidence"],
          properties: {
            messageId: { type: "string", maxLength: 200 },
            fromAddress: { type: "string", format: "email" },
            prospectId: { type: "string" },
            subject: { type: "string", maxLength: 500 },
            body: { type: "string", maxLength: 100000 },
            receivedAt: { type: "string", format: "date-time" },
            classification: {
              type: "string",
              enum: ["interested", "question", "meeting_request", "later", "referral", "not_interested", "out_of_office", "unsubscribe", "unknown"],
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            inReplyTo: { type: "string", maxLength: 500, description: "Header `In-Reply-To` der Antwort" },
            references: {
              oneOf: [{ type: "array", items: { type: "string" }, maxItems: 100 }, { type: "string" }],
              description: "Header `References` der Antwort — Liste oder durch Leerzeichen getrennt",
            },
          },
        },
        OutreachReplyResult: {
          type: "object",
          required: ["messageId", "prospectId", "classification", "duplicate"],
          properties: {
            messageId: { type: "string" },
            prospectId: { type: ["string", "null"] },
            classification: { type: "string" },
            duplicate: { type: "boolean" },
            matchedBy: { type: "string", enum: ["prospect_id", "message_id", "from_address"], description: "Fehlt bei `duplicate: true`" },
          },
        },
        WebhookLead: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            url: { type: "string", format: "uri" },
            pipelineId: { type: "string" },
            stage: ref("Stage"),
            status: { type: "string", enum: ["open", "won", "lost"] },
            valueCents: { type: "integer" },
            currency: { type: "string" },
            lostReason: { type: ["string", "null"] },
            contacts: {
              type: "array",
              items: {
                type: "object",
                properties: { id: { type: "string" }, name: { type: "string" }, email: { type: ["string", "null"] }, isPrimary: { type: "boolean" } },
              },
            },
            sourceRef: { type: ["object", "null"] },
          },
        },
      },
    },
    webhooks: mailwinWebhooks(),
  };
}

/** Umschlag `{ id, type, occurredAt, workspaceId, data }` mit dem Schema von `data`. */
function envelope(type: string, data: Record<string, unknown>) {
  return {
    type: "object",
    required: ["id", "type", "occurredAt", "workspaceId", "data"],
    properties: {
      id: { type: "string", description: "Eindeutig je Ereignis; Wiederholungen tragen dieselbe `id`" },
      type: { type: "string", const: type },
      occurredAt: { type: "string", format: "date-time" },
      workspaceId: { type: "string", description: "Arbeitsbereich (wie `GET /me`); auch als Header `X-Okun-Workspace`" },
      data: { type: "object", ...data },
    },
  };
}

function webhook(type: string, summary: string, description: string, data: Record<string, unknown>) {
  return {
    post: {
      summary,
      description,
      requestBody: { required: true, content: { "application/json": { schema: envelope(type, data) } } },
      responses: { "2XX": { description: "Empfangen. Jeder andere Status oder eine Zeitüberschreitung (10 s) führt zu einer Wiederholung, bis zu 24 Stunden lang." } },
    },
  };
}

function mailwinWebhooks() {
  const leadChange = { required: ["lead"], properties: { lead: ref("WebhookLead"), previousStage: { type: ["object", "null"] } } };
  const nextAction = (extra: Record<string, unknown>) => ({
    required: ["lead", "nextAction"],
    properties: { lead: ref("WebhookLead"), nextAction: { type: "object", properties: { ...extra } } },
  });
  return {
    "lead.stage_changed": webhook("lead.stage_changed", "Phase geändert", "Auch beim Wiederöffnen eines gewonnenen oder verlorenen Leads (`status: open`).", leadChange),
    "lead.won": webhook("lead.won", "Lead gewonnen", "Zusätzlich zu `lead.stage_changed` mit demselben Zeitpunkt.", leadChange),
    "lead.lost": webhook("lead.lost", "Lead verloren", "Mit `lead.lostReason`.", leadChange),
    "lead.deleted": webhook("lead.deleted", "Lead gelöscht", "Zuordnungen in Mailwin lösen; weitere Aufrufe zu diesem Lead liefern 404.", {
      required: ["id"],
      properties: { id: { type: "string" } },
    }),
    "lead.next_action_changed": webhook(
      "lead.next_action_changed",
      "Neue nächste Aktion",
      "Das aktive CRM hat die nächste Aktion festgelegt oder verschoben.",
      nextAction({
        type: { type: "string" },
        title: { type: "string" },
        reason: { type: "string" },
        dueAt: { type: ["string", "null"], format: "date-time" },
        operationalState: { type: "string" },
      }),
    ),
    "lead.next_action_due": webhook(
      "lead.next_action_due",
      "Nächste Aktion ist fällig",
      "Genau einmal je Aktion und Fälligkeit (nach dem Verschieben erneut), nur für Aktionen mit Kundenkontakt: contact_lead, follow_up, chase_offer, schedule_meeting, confirm_meeting, reactivate. Gedacht für einen Nachfass-Entwurf zur Freigabe. Mehr als 24 Stunden Überfälliges wird nicht nachgemeldet.",
      nextAction({
        id: { type: "string" },
        type: { type: "string" },
        title: { type: "string" },
        reason: { type: "string" },
        dueAt: { type: ["string", "null"], format: "date-time" },
      }),
    ),
    "contact.updated": webhook("contact.updated", "Kontakt geändert", "`changed` nennt die geänderten Felder.", {
      required: ["contact", "changed"],
      properties: { contact: ref("Contact"), changed: { type: "array", items: { type: "string" } } },
    }),
    "contact.merged": webhook("contact.merged", "Kontakte zusammengeführt", "`fromId` gibt es danach nicht mehr; alles hängt an `intoId`.", {
      required: ["fromId", "intoId", "contact"],
      properties: { fromId: { type: "string" }, intoId: { type: "string" }, contact: { oneOf: [ref("Contact"), { type: "null" }] } },
    }),
    "signal.proposal_resolved": webhook(
      "signal.proposal_resolved",
      "Vorschlag entschieden",
      "Ein Mensch hat einen Vorschlag aus Mailwin übernommen (`accepted: true`) oder verworfen. `signal` und `externalId` stammen aus dem auslösenden Aufruf (bei Kontaktvorschlägen `signal: contact_details`).",
      {
        required: ["proposalId", "kind", "accepted", "resolvedAt"],
        properties: {
          proposalId: { type: "string" },
          kind: { type: "string", enum: ["deal.mark_won", "deal.mark_lost", "deal.update_value", "contact.update"] },
          accepted: { type: "boolean" },
          signal: { type: ["string", "null"] },
          externalId: { type: ["string", "null"] },
          confidence: { type: ["number", "null"] },
          leadId: { type: ["string", "null"] },
          contactId: { type: ["string", "null"] },
          resolvedAt: { type: "string", format: "date-time" },
        },
      },
    ),
    ping: webhook("ping", "Verbindungstest", "Ausgelöst über „Test senden“ in den Einstellungen.", {
      properties: { workspaceId: { type: "string" }, message: { type: "string" } },
    }),
  };
}
