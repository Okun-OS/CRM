# Mailwin Connect API v1

OKUN Mailwin (KI-E-Mail-Assistent, `Okun-OS/MAILWIN`, https://okun-mailwin.com)
legt aus E-Mails — später auch WhatsApp-Nachrichten — Leads an, schlägt Kontakte
nach und protokolliert Nachrichten. Mailwin ruft auf, das CRM bietet an.

Dieses Dokument beschreibt, wie sich die Schnittstelle in die bestehende
Architektur einfügt. Für Kunden: [`mailwin/MAILWIN-VERBINDEN.md`](mailwin/MAILWIN-VERBINDEN.md).
Für die Gegenseite: [`mailwin/UEBERGABE-MAILWIN.md`](mailwin/UEBERGABE-MAILWIN.md)
und die OpenAPI-Datei [`mailwin/openapi.json`](mailwin/openapi.json).

---

## 1. Ausgangslage im CRM

| Thema | Bestand | Folgerung für Mailwin |
| --- | --- | --- |
| Mandanten | Jede Zeile hat `organizationId`; Services erhalten einen `ActorContext` und filtern mit `scope(ctx)` / `liveScope(ctx)`. | Der Arbeitsbereich kommt ausschließlich aus dem Schlüssel. Kein Feld im Body kann auf einen anderen zeigen. |
| Maschinenzugang | `ApiKey` (nur SHA-256-Hash, Scopes, Widerruf, Ablauf), `machineRoute` für `/api/v1/ingest/events` und `/api/v1/scheduler/run`. | Wiederverwendet: Mailwin-Schlüssel sind `ApiKey`-Zeilen mit genau einem Scope `mailwin:connect` und Präfix `okun_mw_`. |
| API-Konventionen | `/api/v1`, Hülle `{ data }`, Fehler `{ error: { code: "NOT_FOUND", … } }`, Session + CSRF. | Eigener Basis-Pfad `/api/mailwin/v1` mit dem in der Anforderung festgelegten Vertrag (Antworten ohne Hülle, Codes in snake_case). Eigener Rahmen `mailwinRoute`, der dieselben Services nutzt. |
| Kontakte, Firmen | `Contact` (Pflicht: `firstName`, `lastName`), `Company` (`domain` normalisiert). | Name wird zerlegt; Firma über Domain, sonst Name. |
| Leads/Deals | `Lead` = eingehende Anfrage **ohne** Pipeline; `Deal` = Chance in Pipeline und Phase, mit Wert, gewonnen/verloren. | Mailwins „Lead“ braucht Pipeline, Phase, Wert und Gewonnen/Verloren — das ist der **Deal**. |
| Zeitleiste | `Activity` ist der eine Strom je Datensatz; das aktive CRM reagiert auf `EMAIL_RECEIVED` usw. | Mailwin-Nachrichten werden `Activity`-Zeilen; eingehende Nachrichten zu einem Lead melden dem aktiven CRM „Kunde hat geantwortet“. |
| Ereignisse | `emitDomainEvent` → Workflows, Webhooks, aktives CRM. | Mailwin-Änderungen lösen Workflows und das aktive CRM aus wie jede Eingabe. Webhooks an Mailwin hängen an denselben Ereignissen. |
| Webhooks | `WebhookEndpoint`/`WebhookDelivery`, HMAC-SHA256 über `timestamp.body`, 5 Versuche. Wiederholungen hingen an einem externen Scheduler, der nirgends aufgerufen wurde. | Format `MAILWIN` auf derselben Tabelle; Zustell-Worker im Serverprozess (gilt jetzt auch für normale Webhooks). |
| Audit | `AuditLog` je Änderung. | Neue Spalte `origin` — Änderungen über Mailwin stehen mit „über Mailwin“ im Audit-Log. |

## 2. Zuordnung Mailwin → CRM

| Mailwin | CRM | Anmerkung |
| --- | --- | --- |
| `workspaceId` | `Organization.id` | |
| `contact.name` | `Contact.firstName` + `lastName` | „Max Mustermann“ → Max / Mustermann, „Mustermann, Max“ ebenso. Ohne Namen aus der Adresse (`max.mustermann@…`). Nicht Ableitbares heißt „Unbekannt“ (wie bei der Lead-Umwandlung) und wird ersetzt, sobald Mailwin einen echten Namen schickt. |
| `contact.phone` | `Contact.phone` (Ausgabe: `phone ?? mobile`) | |
| `company` | `Company` | `domain` normalisiert (ohne `https://`, `www.`, Pfad). |
| `lead` | `Deal` | `title` → `name`, `description` → `description`, `valueCents` → `amount` (÷ 100, Währung der Organisation). |
| `lead.stage` | `PipelineStage.name` (dazu `stageId`, `pipelineId`) | |
| `pipeline.stages[].order` | Rang nach `PipelineStage.position`, ab 0 | Zusätzlich `type: open/won/lost` und `isDefault`. |
| `sourceRef` | `Deal.sourceRef` (JSON) | Erscheint am Deal als „In Mailwin öffnen“. |
| `source: "mailwin"` | `Contact.source`, `Company.source`, `Deal.source` = `mailwin`; `Activity.source` = `MAILWIN` | |
| `activity.type` | `ActivityType`: `email` → `EMAIL`, `whatsapp` → `WHATSAPP` (neu), `note` → `NOTE` | |
| `activity.summary` | `Activity.body` | |
| `activity.externalId` | `Activity.externalSource = "mailwin"` + `externalId` | Eindeutig je Organisation. |
| `activity.url` | `Activity.metadata.url` | Erscheint als „In Mailwin öffnen“. |
| Webhook `lead.stage_changed` / `lead.won` / `lead.lost` | Domänenereignis `deal.stage_changed` / `deal.won` / `deal.lost` | |
| Webhook `contact.updated` | `contact.updated` | |

## 3. Aufbau

```
Mailwin ──HTTPS──▶ /api/mailwin/v1/*        src/app/api/mailwin/v1/**/route.ts
                    │
                    ▼  mailwinRoute()       src/server/mailwin/http.ts
                    │   1. Bearer-Schlüssel → Arbeitsbereich        401
                    │   2. Scope mailwin:connect, Arbeitsbereich aktiv  403
                    │   3. 120 Anfragen/Minute/Schlüssel           429 + Retry-After
                    │   4. Body lesen (≤ 256 KB, JSON)             400 / 413
                    │   5. Idempotency-Key (24 h)                  Wiederholung / 409 / 422
                    │   6. ActorContext { origin: "mailwin" }
                    │   7. Aufrufprotokoll (IntegrationRequestLog)
                    ▼
                  Fachlogik                 src/server/mailwin/service.ts
                    │  createContact / updateContact / createCompany / createDeal
                    ▼  (bestehende Services: Audit, Zeitleiste, Ereignisse)
                  emitDomainEvent ──▶ Workflows · aktives CRM · Webhooks
                                                          │
                     Format MAILWIN ◀─────────────────────┘
                     src/server/mailwin/webhooks.ts  (Hülle, Echo-Sperre)
                     src/server/services/webhooks.ts (Signatur, Backoff bis 24 h)
                     src/server/services/webhook-worker.ts (alle 15 s, gestartet in src/instrumentation.ts)
```

| Datei | Aufgabe |
| --- | --- |
| `src/lib/crm/mailwin.ts` | Scope, Pfade, Ereignisnamen (auch für die Oberfläche) |
| `src/server/mailwin/http.ts` | Rahmen jedes Aufrufs |
| `src/server/mailwin/errors.ts` | Fehlervertrag |
| `src/server/mailwin/idempotency.ts` | `Idempotency-Key` |
| `src/server/mailwin/schemas.ts` | Eingabe-Validierung (Zod) |
| `src/server/mailwin/service.ts` | Fachlogik und Zuordnung |
| `src/server/mailwin/webhooks.ts` | Webhooks an Mailwin |
| `src/server/mailwin/settings.ts` | Verwaltung (Schlüssel, Webhook, Protokolle) |
| `src/server/mailwin/openapi.ts` | OpenAPI 3.1 (→ `docs/mailwin/openapi.json` via `pnpm mailwin:openapi`) |
| `src/app/(app)/settings/integrations/mailwin` | Oberfläche |
| `tests/mailwin.test.ts` | Tests über die echten Route-Handler |

### Datenmodell (Migration `20261030090000_mailwin_connect`, nur additiv)

- `Activity.externalSource`, `Activity.externalId` + `@@unique([organizationId, externalSource, externalId])`
- `ActivityType.WHATSAPP`, `ActivitySource.MAILWIN`
- `Deal.sourceRef` (JSON)
- `AuditLog.origin`
- `WebhookEndpoint.format` (`STANDARD` | `MAILWIN`)
- neue Tabellen `IdempotencyRecord`, `IntegrationRequestLog`

Keine bestehende Spalte wurde umbenannt, entfernt oder umgedeutet.

## 4. Entscheidungen

**Lead = Deal.** Mailwins Lead hat Pipeline, Phase, Wert und endet gewonnen oder
verloren — genau das ist im CRM der Deal. Das CRM-Objekt `Lead` (eingehende
Anfrage vor der Qualifizierung, ohne Pipeline) wäre semantisch näher an „aus
einer E-Mail erkannt“, kann aber keine Phase, keinen Wert und kein
Gewonnen/Verloren tragen. Die Links (`url`) führen deshalb auf `/deals/<id>`.

**Ergänzen statt Überschreiben.** `POST /contacts` füllt bei einem bestehenden
Kontakt nur leere Felder (Telefon, Firma) und ersetzt nur einen Platzhalternamen.
Was jemand im CRM gepflegt hat, überschreibt Mailwin nie. Bei mehreren Kontakten
mit derselben Adresse gilt der älteste.

**Freemail-Domains** (gmail.com, web.de, gmx.de …) ordnen keine Firma zu und
legen keine an.

**Pflichtfelder.** Eigene Pflicht-Eigenschaften eines Arbeitsbereichs kennt
Mailwin nicht. Über Mailwin angelegte Datensätze werden deshalb nicht an ihnen
abgelehnt (`CreateOptions.skipRequiredProperties`); die Felder bleiben leer, bis
jemand sie ausfüllt.

**In wessen Namen.** Aufrufe laufen als die Person, die den Schlüssel erzeugt hat
(solange sie Administrator ist, sonst die erste Administratorin). Neue Kontakte
gehören dieser Person; neue Leads dem Owner des Kontakts. Die *Rechte* des
Schlüssels begrenzt der Scope: Er erreicht ausschließlich `/api/mailwin/v1/*`,
und kein anderer Schlüssel erreicht diese Endpunkte. In Zeitleiste und Audit-Log
steht „über Mailwin“; Mailwin-Nachrichten haben keine Person als Urheber.

**Idempotenz.** Gespeichert werden nur erfolgreiche Antworten (2xx). Ein
abgelehnter Aufruf hat nichts angelegt und darf mit korrigierten Daten unter
demselben Schlüssel wiederholt werden. Derselbe Schlüssel mit anderem Inhalt →
422 `idempotency_key_reused`; läuft die erste Anfrage noch → 409
`idempotency_key_in_use` mit `Retry-After: 1`. `POST /activities` ist zusätzlich
über `externalId` idempotent (200 mit bestehender `id`).

**Gleichzeitigkeit.** Parallele Aufrufe für dieselbe E-Mail-Adresse (oder
Firma) laufen nacheinander, damit nichts doppelt entsteht — über eine Sperre im
Serverprozess. Das CRM läuft als eine Instanz (`railway.json`,
`numReplicas: 1`), wie es auch der Rate-Limiter voraussetzt. **Bei mehreren
Instanzen** gehören Sperre und Rate-Limit in einen gemeinsamen Speicher (Redis
oder Postgres); Idempotenz und Webhook-Zustellung sind bereits datenbankgestützt
und mehrinstanzfähig.

**Echo-Sperre.** Ändert Mailwin selbst einen Kontakt, geht dafür kein
`contact.updated` an Mailwin zurück.

**Webhooks asynchron.** Die auslösende Anfrage wartet nie auf Mailwin. Die
Zustellung startet direkt nach der Antwort; Fehlschläge wiederholt der Worker mit
30 s, 1, 2, 4 … Minuten Abstand (höchstens 4 h), der letzte Versuch liegt genau
24 h nach dem Ereignis. Vor dem Senden wird jede Zustellung reserviert, damit
nichts doppelt verschickt wird. Ein Phasenwechsel auf „Gewonnen“ erzeugt zwei
Meldungen: `lead.stage_changed` und `lead.won`.

**Protokoll.** Jeder Aufruf mit gültigem Schlüssel landet im Aufrufprotokoll
(Methode, Pfad ohne Query, Status, Dauer, Schlüssel), 30 Tage lang. Die Query
(`?email=`) wird bewusst nicht gespeichert. Aufrufe ohne gültigen Schlüssel
gehören zu keinem Arbeitsbereich und stehen nur im Anwendungslog.

## 4a. v1.2: Signale, Vorschläge, Kontext

| Endpunkt | Datei | Kern |
| --- | --- | --- |
| `POST /leads/{id}/signals` | `src/server/mailwin/signals.ts` | Mailwin meldet Erkanntes (Angebot versendet/angenommen/abgelehnt, Termin, Rückfrage, Abwesenheit, Vertrag); das CRM entscheidet nach `IntegrationSetting` (`signal-settings.ts`). Erst Folgen (Phase, Termin, Vorschlag), dann das Engine-Ereignis — damit die nächste Aktion auf dem neuen Stand berechnet wird. |
| `GET /leads/{id}` | `src/server/mailwin/actions.ts` | Kontext für Antwortentwürfe |
| `POST /tasks` | `actions.ts` | Aufgabe für den Owner |
| `POST /contacts/{id}/suggestions` | `actions.ts` | leere Felder füllen, Abweichungen vorschlagen |
| `POST /outreach/replies` | `actions.ts` → `recordReply` (`judged`) | Mailwins Einstufung ersetzt die Schlüsselwort-Regel |
| Webhook `lead.next_action_changed` | `reconcileSubject` → `queueNextActionChanged` | jede neue nächste Aktion eines Deals, mit Fälligkeit |

**Vorschläge** (`RecordSuggestion`, `src/server/services/suggestions.ts`) sind
allgemein gebaut, nicht Mailwin-spezifisch: Eine Integration schlägt vor
(`deal.mark_won`, `deal.mark_lost`, `contact.update`), ein Mensch übernimmt oder
verwirft an Deal bzw. Kontakt. Ein Vorschlag an einem Deal ist zugleich dessen
manuelle nächste Aktion („Heute“); die Entscheidung erledigt sie.

**Entscheidungen:** Gewonnen/Verloren standardmäßig nur als Vorschlag
(umstellbar auf „automatisch ab Verlässlichkeit X“); Phasen nur vorwärts, nie aus
Gewonnen/Verloren heraus; Zuordnung Signal → Phase je Pipeline, Standard über
die Phasen-Schlüssel `proposal`, `meeting`, `negotiation`; Angebotswert füllt nur
einen leeren Wert (umstellbar); eine Abwesenheitsnotiz pausiert Automationen und
zählt ausdrücklich nicht als Kundenantwort.

Migration `20261030170000_mailwin_signals`, nur additiv: `RecordSuggestion`,
`SuggestionStatus`, `IntegrationSetting`.

## 5. Später: OAuth 2.0 und weitere Kanäle

**OAuth 2.0 (Authorization Code + PKCE)** als Alternative zum Schlüssel, damit
Kunden per Klick verbinden:

- Die Endpunkte sehen nur `MailwinPrincipal` (`kind`, `credentialId`,
  `organizationId`). `authenticate()` in `http.ts` löst heute einen API-Schlüssel
  dazu auf; ein Access-Token wird später an derselben Stelle aufgelöst
  (`kind: "oauth"`). Endpunkte, Rate-Limit (je `credentialId`), Idempotenz und
  Protokoll bleiben unverändert.
- Neu dazu kämen: `OAuthClient` (Mailwin als registrierter Client mit
  Redirect-URIs), `OAuthAuthorizationCode` (kurzlebig, mit
  `code_challenge`), `OAuthToken` (Access- und Refresh-Token nur als Hash,
  Scope `mailwin:connect`, Widerruf), eine Zustimmungsseite
  „Mailwin möchte auf Arbeitsbereich X zugreifen“ für Administratoren und die
  Endpunkte `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`.
- In der Oberfläche erscheinen OAuth-Verbindungen neben den Schlüsseln und
  lassen sich genauso widerrufen.

**WhatsApp** nutzt dieselben Endpunkte mit `channel: "whatsapp"` bzw.
`type: "whatsapp"`; die Zeitleiste kennt den Typ bereits, das aktive CRM wertet
eine eingehende WhatsApp-Nachricht zu einem Lead als Kundenantwort.

## 6. Betrieb

- Zustell-Worker: startet automatisch mit dem Server (`src/instrumentation.ts`),
  alle 15 s; abschaltbar mit `WEBHOOK_WORKER=off`.
- Wartung (stündlich im Worker): abgelaufene Idempotenz-Einträge löschen,
  Aufrufprotokolle älter als 30 Tage löschen.
- Testarbeitsbereich mit Schlüssel: `pnpm mailwin:sandbox`
  (optional `-- --webhook-url=… --webhook-secret=…`).
- OpenAPI-Datei neu schreiben: `pnpm mailwin:openapi` (ein Test prüft die Übereinstimmung).
