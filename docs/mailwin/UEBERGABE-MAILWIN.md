# Übergabe an Mailwin: OKUN CRM — Mailwin Connect API v1

Diese Zusammenfassung ist für die Entwicklung der Mailwin-Seite gedacht.
Welche Abläufe sich damit abbilden lassen (Bestandskunde schreibt, Angebot
verschickt, Kunde nimmt per E-Mail an …), steht im [Zusatz](ZUSATZ-ABLAEUFE.md).
Aktueller Stand: **v1.2** (OpenAPI-Version 1.2.0). Die
vollständige, maschinenlesbare Beschreibung steht in der OpenAPI-3.1-Datei
(`<APP_URL>/api/mailwin/v1/openapi.json`, im CRM-Repository unter
`docs/mailwin/openapi.json`).

## Eckdaten

| | |
| --- | --- |
| Basis-URL | `<APP_URL>/api/mailwin/v1` — Produktion: `https://crm-production-8f9e.up.railway.app/api/mailwin/v1` (sobald ausgerollt) |
| Authentifizierung | `Authorization: Bearer okun_mw_…` — ein Schlüssel pro Arbeitsbereich, erzeugt im CRM unter Einstellungen → Integrationen → Mailwin |
| Format | JSON, UTF-8; Antworten **ohne** Hülle (direkt das Objekt bzw. Array) |
| Zeitstempel | ISO 8601 mit Zeitzone. Eingaben **müssen** eine Zone tragen (`Z` oder `+01:00`), sonst 422. Antworten sind UTC (`…Z`). Ereigniszeitpunkte (`occurredAt`, `receivedAt`) in der Zukunft werden auf „jetzt“ gesetzt (Uhrabweichung); Termine und Fälligkeiten dürfen in der Zukunft liegen. |
| Rate-Limit | 120 Anfragen pro Minute und Schlüssel; Header `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (Sekunden); bei 429 `Retry-After` |
| Idempotenz | Header `Idempotency-Key` (1–255 sichtbare ASCII-Zeichen) bei allen POST; 24 h gültig; Wiederholung trägt `Idempotent-Replayed: true` |
| Korrelation | Jede Antwort trägt `X-Request-Id` |
| Unbekannte Felder | werden ignoriert, nicht abgelehnt |

**Begriff:** Ein Mailwin-„Lead“ ist im CRM ein **Deal** (Pipeline, Phase, Wert,
gewonnen/verloren). IDs und `url` eines Leads sind die des Deals
(`<APP_URL>/deals/<id>`).

## Endpunkte

| Methode | Pfad | Erfolg |
| --- | --- | --- |
| GET | `/me` | 200 `{ workspaceId, name, appUrl }` |
| GET | `/contacts?email=<adresse>` | 200 `Contact[]` (leer, wenn keiner; höchstens 20, älteste zuerst) |
| POST | `/contacts` | 201 neu angelegt · 200 bestehender Kontakt (ggf. ergänzt) — Body: `Contact` |
| GET | `/pipelines` | 200 `Pipeline[]` (Standard-Pipeline zuerst) |
| POST | `/leads` | 201 `{ id, url }` |
| POST | `/activities` | 201 neu · 200 bereits vorhanden (gleiche `externalId`) — Body: `{ id }` |
| GET | `/leads/{id}` | 200 Kontext: Phase, Wert, Kontakte, nächste Aktion, offene Aufgaben, letzte Nachrichten, offene Vorschläge (v1.2) |
| POST | `/leads/{id}/signals` | 201 bzw. 200 (Wiederholung) `{ signal, duplicate, applied, proposed, ignored, lead }` — Angebot/Vertrag versendet, angenommen, abgelehnt, Termin, Rückfrage, Abwesenheit (v1.2) |
| POST | `/tasks` | 201 `{ id, url }` — Aufgabe für den Owner des Leads/Kontakts (v1.2) |
| POST | `/contacts/{id}/suggestions` | 200 `{ applied, proposed, contact }` — leere Felder füllen, Abweichungen vorschlagen (v1.2) |
| POST | `/outreach/replies` | 201 bzw. 200 (Wiederholung) — Mailwins Einstufung einer Akquise-Antwort (v1.2) |
| GET | `/openapi.json` | 200, ohne Schlüssel |

`Contact` = `{ id, name, email, phone, company: { id, name, domain } | null, openLeads: [{ id, title, stage, stageId, pipelineId, url }], url }`

## Abweichungen und Präzisierungen gegenüber der Anfrage

1. **Lead = Deal** im CRM (siehe oben). `openLeads` sind die offenen Deals, an denen der Kontakt beteiligt ist.
2. **`openLeads[]` hat zusätzlich** `stageId` und `pipelineId`; `stage` ist der Phasenname.
3. **`GET /pipelines`** liefert zusätzlich `isDefault` und je Phase `type` (`open` | `won` | `lost`). `order` beginnt bei 0.
4. **`POST /contacts` ergänzt nur, überschreibt nie.** Bei einem bestehenden Kontakt (Abgleich über E-Mail, Groß-/Kleinschreibung egal; bei mehreren gilt der älteste) werden nur leere Felder gefüllt (Telefon, Firma). Der Name wird nur ersetzt, wenn er ein Platzhalter ist (siehe 5). Statuscode unterscheidet: 201 angelegt, 200 vorhanden.
5. **Namen:** `name` wird in Vor- und Nachname zerlegt („Max Mustermann“, auch „Mustermann, Max“). Ohne `name` wird er aus der Adresse abgeleitet (`max.mustermann@…` → Max Mustermann). Nicht Ableitbares (z. B. `info@…`) heißt „Unbekannt info@firma.de“ — und wird beim nächsten Aufruf mit echtem Namen ersetzt.
6. **Firmen:** Zuordnung über `companyDomain` (normalisiert, `https://www.` und Pfad werden entfernt), sonst über `companyName` (Groß-/Kleinschreibung egal), sonst Neuanlage. **Freemail-Domains** (gmail.com, gmx.de, web.de, outlook.com …) werden ignoriert. Ohne `companyName`/`companyDomain` wird keine Firma aus der E-Mail-Adresse abgeleitet. Ein Kontakt, der schon eine Firma hat, behält sie.
7. **`POST /leads`:** `stageId` allein bestimmt auch die Pipeline. Unbekannte oder nicht zusammenpassende `pipelineId`/`stageId` → **422** (nicht 404). Ohne beides: Standard-Pipeline, erste offene Phase. `description` ist Pflicht, darf aber leer sein. Alle vier `sourceRef`-Felder sind Pflicht; `sourceRef.url` muss http(s) sein. `valueCents` ist eine ganze Zahl; die Währung ist die des Arbeitsbereichs (meist EUR). Der neue Lead gehört dem Owner des Kontakts.
8. **`POST /activities`:** `url` muss http(s) sein. `contactId`/`leadId`, die es im Arbeitsbereich nicht gibt, → **404**. Eine bereits gemeldete `externalId` liefert **200** mit der bestehenden `id` (der Inhalt der zweiten Meldung wird verworfen). Eine **eingehende** E-Mail/WhatsApp mit `leadId` zählt im CRM als Antwort des Kunden (stoppt z. B. eine geplante Nachfass-Automation).
9. **Idempotenz:** Gespeichert werden nur erfolgreiche Antworten (2xx). Nach 4xx ist der Schlüssel wieder frei — korrigiert erneut senden ist erlaubt. Derselbe Schlüssel mit **anderem** Body → **422** `idempotency_key_reused`. Läuft die erste Anfrage noch → **409** `idempotency_key_in_use` mit `Retry-After: 1`. Empfehlung: `Idempotency-Key` = Mailwin-Nachrichten-ID + Aktion, z. B. `lead:msg_456`.
10. **Fehler:** Hülle `{ "error": { "code", "message" } }`, bei 422 zusätzlich `details.fields` (Feldpfade wie `contact.email`, `sourceRef.url`). Codes: `invalid_request` (400), `unauthorized` (401), `forbidden` (403: Schlüssel ohne Mailwin-Freigabe oder Arbeitsbereich gesperrt), `not_found` (404), `conflict` / `idempotency_key_in_use` (409), `payload_too_large` (413, > 256 KB), `validation_failed` / `idempotency_key_reused` (422), `rate_limited` (429), `internal_error` (500). Meldungen sind deutsch; bitte auf `code` verzweigen.
11. **Webhooks:** zusätzliche Header `X-Okun-Event` (= `type`) und `X-Okun-Delivery`; zusätzlicher Typ **`ping`** beim „Testereignis senden“. Ein Wechsel in eine Gewonnen-/Verloren-Phase erzeugt **zwei** Meldungen (`lead.stage_changed` und `lead.won`/`lead.lost`). Änderungen, die Mailwin selbst über die API ausgelöst hat, werden **nicht** zurückgemeldet.

## Beispiele (echte Antworten aus dem Test, Adresse ersetzt)

### Schlüssel prüfen

```http
GET /api/mailwin/v1/me
Authorization: Bearer okun_mw_…
```
```http
HTTP/1.1 200 OK
RateLimit-Limit: 120
RateLimit-Remaining: 119
RateLimit-Reset: 60

{"workspaceId":"cmvv4b9hr0000pb7dafcqc8pi","name":"Mailwin Sandbox","appUrl":"https://crm.example.com"}
```

### Kontakt nachschlagen

```http
GET /api/mailwin/v1/contacts?email=ERIKA@beispiel-ag.de
```
```json
[
  {
    "id": "cmvv4b9ta000rpb7dleaeuylu",
    "name": "Erika Musterfrau",
    "email": "erika@beispiel-ag.de",
    "phone": "+49 30 1234567",
    "company": { "id": "cmvv4b9l2000opb7d2mdjk9n6", "name": "Beispiel AG", "domain": "beispiel-ag.de" },
    "openLeads": [
      {
        "id": "cmvv4b9uj000vpb7dg691y2uq",
        "title": "Rahmenvertrag 2027",
        "stage": "Qualifiziert",
        "stageId": "cmvv4b9in000gpb7df5wcsrxl",
        "pipelineId": "cmvv4b9ik000epb7ddg1681fr",
        "url": "https://crm.example.com/deals/cmvv4b9uj000vpb7dg691y2uq"
      }
    ],
    "url": "https://crm.example.com/contacts/cmvv4b9ta000rpb7dleaeuylu"
  }
]
```

### Kontakt anlegen oder ergänzen

```http
POST /api/mailwin/v1/contacts
Content-Type: application/json
Idempotency-Key: contact:msg_9000

{"email":"jonas.becker@nordwerk.de","name":"Jonas Becker","phone":"+49 40 555123","companyName":"Nordwerk GmbH","companyDomain":"nordwerk.de"}
```
→ `201` (neu) oder `200` (vorhanden) mit dem `Contact`-Objekt.

### Pipelines

```json
[
  {
    "id": "cmvv4b9ik000epb7ddg1681fr",
    "name": "Vertriebspipeline",
    "isDefault": true,
    "stages": [
      { "id": "cmvv4b9in000fpb7drrk4vq0y", "name": "Lead", "order": 0, "type": "open" },
      { "id": "cmvv4b9in000gpb7df5wcsrxl", "name": "Qualifiziert", "order": 1, "type": "open" },
      { "id": "cmvv4b9in000hpb7d1of5ddmw", "name": "Termin", "order": 2, "type": "open" },
      { "id": "cmvv4b9in000ipb7djscm3npm", "name": "Angebot", "order": 3, "type": "open" },
      { "id": "cmvv4b9in000jpb7dy1jcne9w", "name": "Verhandlung", "order": 4, "type": "open" },
      { "id": "cmvv4b9in000kpb7d2yfk7xxv", "name": "Gewonnen", "order": 5, "type": "won" },
      { "id": "…", "name": "Verloren", "order": 6, "type": "lost" }
    ]
  }
]
```

### Lead anlegen (Kontakt und Firma existieren noch nicht)

```http
POST /api/mailwin/v1/leads
Content-Type: application/json
Idempotency-Key: lead:msg_9001

{
  "contact": { "email": "jonas.becker@nordwerk.de", "name": "Jonas Becker" },
  "companyName": "Nordwerk GmbH",
  "title": "Anfrage: Wartungsvertrag 3 Standorte",
  "description": "Herr Becker bittet um ein Angebot für die Wartung an drei Standorten ab Januar.",
  "valueCents": 2400000,
  "source": "mailwin",
  "sourceRef": {
    "channel": "email",
    "threadId": "thr_9001",
    "messageId": "msg_9001",
    "url": "https://okun-mailwin.com/inbox/thr_9001"
  }
}
```
```http
HTTP/1.1 201 Created

{"id":"cmvv4dngx000bwq7d989hmq3m","url":"https://crm.example.com/deals/cmvv4dngx000bwq7d989hmq3m"}
```
Dieselbe Anfrage mit demselben `Idempotency-Key` erneut → dieselbe Antwort, `Idempotent-Replayed: true`, kein zweiter Lead.

### Nachricht protokollieren

```http
POST /api/mailwin/v1/activities
Content-Type: application/json

{
  "contactId": "cmvv4dnfd0007wq7dk42zslrg",
  "leadId": "cmvv4dngx000bwq7d989hmq3m",
  "type": "whatsapp",
  "direction": "inbound",
  "subject": "Rückfrage Termin",
  "summary": "Herr Becker schlägt Dienstag 10 Uhr für die Begehung vor.",
  "occurredAt": "2026-10-30T16:05:00+01:00",
  "externalId": "wa_9001_1",
  "url": "https://okun-mailwin.com/inbox/wa/9001"
}
```
→ `201 {"id":"cmvv4dnl4000kwq7d9wznyfi5"}`; dieselbe `externalId` erneut → `200` mit derselben `id`.

### Fehler

```json
// 422 — occurredAt ohne Zeitzone
{"error":{"code":"validation_failed","message":"Die übermittelten Daten sind ungültig.","details":{"fields":{"occurredAt":"Bitte einen Zeitpunkt nach ISO 8601 mit Zeitzone angeben, z. B. 2026-10-30T09:15:00+01:00."}}}}

// 401 — falscher oder widerrufener Schlüssel
{"error":{"code":"unauthorized","message":"Der API-Schlüssel fehlt, ist ungültig oder wurde widerrufen."}}

// 429
{"error":{"code":"rate_limited","message":"Zu viele Anfragen: höchstens 120 pro Minute und Schlüssel."}}   (+ Retry-After)
```

## Webhooks an Mailwin (v1.1)

Standard-Ziel: `https://okun-mailwin.com/api/integrations/okun-crm/webhook`
(im CRM änderbar). Das gemeinsame Geheimnis trägt der Kunde im CRM ein (oder
lässt es dort erzeugen und trägt es in Mailwin ein).

```http
POST /api/integrations/okun-crm/webhook
Content-Type: application/json
User-Agent: OKUN-CRM-Webhooks/1.0
X-Okun-Event: lead.won
X-Okun-Delivery: <Zustell-ID>
X-Okun-Timestamp: 1793373690
X-Okun-Signature: sha256=91157f85df56951aa58b328a4ed277ddcee05655eca5fc42e7a03842c6c1862e
```

Echtes Beispiel (`lead.won`):

```json
{
  "id": "evt_c9dfc29f-ab1b-4248-b317-d99e550e289f",
  "type": "lead.won",
  "occurredAt": "2026-10-30T15:21:30.575Z",
  "data": {
    "lead": {
      "id": "cmvv4dngx000bwq7d989hmq3m",
      "title": "Anfrage: Wartungsvertrag 3 Standorte",
      "url": "https://crm.example.com/deals/cmvv4dngx000bwq7d989hmq3m",
      "pipelineId": "cmvv4b9ik000epb7ddg1681fr",
      "stage": { "id": "cmvv4b9in000kpb7d2yfk7xxv", "name": "Gewonnen", "type": "won" },
      "status": "won",
      "valueCents": 2400000,
      "currency": "EUR",
      "lostReason": null,
      "contacts": [
        { "id": "cmvv4dnfd0007wq7dk42zslrg", "name": "Jonas Becker", "email": "jonas.becker@nordwerk.de", "isPrimary": true }
      ],
      "sourceRef": {
        "system": "mailwin",
        "channel": "email",
        "threadId": "thr_9001",
        "messageId": "msg_9001",
        "url": "https://okun-mailwin.com/inbox/thr_9001"
      }
    },
    "previousStage": { "id": "cmvv4b9in000fpb7drrk4vq0y", "name": "Lead" }
  }
}
```

- `lead.stage_changed`, `lead.won`, `lead.lost`: `data = { lead, previousStage }` wie oben. `sourceRef` ist `null` bei Leads, die nicht aus Mailwin stammen.
- `contact.updated`: `data = { contact: <Contact wie bei GET /contacts>, changed: ["phone", "companyId", …] }`.
- `lead.next_action_changed` (v1.2): `data = { lead, nextAction: { type, title, reason, dueAt, operationalState } }` — z. B. `chase_offer` / „Angebot nachfassen“ mit Fälligkeit. Wird auch gesendet, wenn Mailwin die Änderung über ein Signal angestoßen hat.
- `ping`: `data = { workspaceId, message }`.
- Reihenfolge der Schlüssel im JSON ist nicht garantiert — die Signatur gilt für den **Rohbody**, wie er ankommt.

**Signatur prüfen** (Node.js):

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody: string, timestamp: string, signature: string, secret: string): boolean {
  // Gegen Wiederholungsangriffe: nur Zeitstempel der letzten 5 Minuten annehmen.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

Hinweis zur 5-Minuten-Prüfung: Eine wiederholte Zustellung trägt einen **neuen**
Zeitstempel und eine neue Signatur; Duplikate erkennt Mailwin an `id`.

**Zustellung:** asynchron, kurz nach dem Ereignis. Jede Antwort 2xx gilt als
angenommen; alles andere (auch Zeitüberschreitung nach 10 s) wird wiederholt —
30 s, 1, 2, 4, 8 … Minuten, höchstens 4 h Abstand, letzter Versuch 24 h nach
dem Ereignis. Mailwin sollte schnell 2xx antworten und idempotent über `id`
verarbeiten.

## Testumgebung und Testschlüssel

- **Testinstanz:** eine eigene Railway-Umgebung „test“ des CRM mit **eigener, leerer Datenbank** — keine Produktivdaten. Adresse: `<TEST_APP_URL>` (wird nachgereicht), Basis-URL `<TEST_APP_URL>/api/mailwin/v1`.
- **Test-Arbeitsbereich mit Schlüssel:** auf der Testinstanz `pnpm mailwin:sandbox` ausführen. Das legt (einmalig) den Arbeitsbereich „Mailwin Sandbox“ mit Beispieldaten an und gibt Basis-URL und einen neuen Schlüssel aus. Mit `-- --webhook-url=<URL> --webhook-secret=<Geheimnis>` wird zugleich der Webhook an Mailwin eingerichtet.
- **Testdaten im Sandbox-Arbeitsbereich:** Kontakt `erika@beispiel-ag.de` (Firma Beispiel AG, offener Lead „Rahmenvertrag 2027“ in Phase „Qualifiziert“).
- Der Schlüssel sieht ausschließlich den Sandbox-Arbeitsbereich. Für Mailwin-Tests bitte nie einen Schlüssel aus einem Kunden-Arbeitsbereich verwenden.
- **Lokal:** CRM mit `pnpm dev` starten, `pnpm mailwin:sandbox` ausführen, Basis-URL `http://localhost:3000/api/mailwin/v1`. Webhook-Ziele mit `http://localhost:<port>/…` sind für lokale Tests erlaubt, sonst nur https.
- **Grenzen der Testumgebung:** Das Rate-Limit gilt je Schlüssel und Serverprozess; ein Neustart setzt es zurück.

**Testschlüssel:** `<wird nachgereicht — auf der Testinstanz erzeugt>`

Alternativ ohne Skript: auf der Testinstanz unter `/register` ein Konto anlegen, dann
Einstellungen → Integrationen → Mailwin → **Schlüssel erzeugen**.
