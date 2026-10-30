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
      version: "1.0.0",
      description: [
        "Schnittstelle, über die OKUN Mailwin Kontakte nachschlägt, Leads anlegt und Nachrichten protokolliert.",
        "",
        "**Begriffe:** Ein Mailwin-„Lead“ ist im CRM ein Deal (Pipeline, Phase, Wert, gewonnen/verloren).",
        "",
        "**Zeitstempel** sind ISO 8601 mit Zeitzone; Antworten verwenden UTC (`Z`).",
        "",
        "**Rate-Limit:** 120 Anfragen pro Minute und Schlüssel. Jede Antwort trägt `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.",
        "",
        "**Webhooks (v1.1)** an Mailwin: `POST` mit `{ id, type, occurredAt, data }`, Typen `lead.stage_changed`, `lead.won`, `lead.lost`, `contact.updated` (und `ping` beim Verbindungstest). Header `X-Okun-Timestamp` (Unix-Sekunden) und `X-Okun-Signature: sha256=<hex HMAC-SHA256 über \"<timestamp>.<rohbody>\">`.",
      ].join("\n"),
    },
    servers: [{ url: MAILWIN_API_BASE_PATH, description: "Relativ zur Adresse der CRM-Instanz, z. B. https://crm.example.com" }],
    security: [{ apiKey: [] }],
    tags: [{ name: "Zugang" }, { name: "Kontakte" }, { name: "Leads" }, { name: "Aktivitäten" }],
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
                threadId: "thr_123",
                messageId: "msg_456",
                url: "https://okun-mailwin.com/inbox/thr_123",
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
              externalId: "msg_789",
              url: "https://okun-mailwin.com/inbox/thr_123#msg_789",
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
      },
    },
  };
}
