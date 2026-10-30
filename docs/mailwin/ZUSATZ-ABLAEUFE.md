# Zusatz für Mailwin: Was das CRM kann und wie Mailwin es nutzen kann

Ergänzung zur [Übergabe](UEBERGABE-MAILWIN.md). Sie beantwortet drei Fragen:
Was kann OKUN CRM? Welche Abläufe lassen sich damit abbilden — vom ersten
Kontakt über das Angebot bis zur Zusage? Und was muss Mailwin dafür liefern?

> **Stand:** v1.2 ist gebaut und ausgerollt. Alles in diesem Dokument ist
> verfügbar; die maschinenlesbare Beschreibung steht in der OpenAPI-Datei
> (Version 1.2.0).

---

## 1. Was OKUN CRM kann (Kurzüberblick)

| Bereich | Inhalt |
| --- | --- |
| Kontakte & Firmen | Stammdaten, Lifecycle-Stufe (Lead → Kunde), Owner, eigene Felder, Dublettenprüfung |
| Deals (= Mailwin-Leads) | Pipelines mit Phasen (Standard: Lead → Qualifiziert → Termin → Angebot → Verhandlung → Gewonnen/Verloren), Wert, Wahrscheinlichkeit, Phasenverlauf |
| Zeitleiste | Ein Strom je Datensatz: E-Mails, WhatsApp, Anrufe, Notizen, Termine, Systemereignisse |
| Aufgaben, Notizen, Termine | mit Fälligkeit und Owner; Kalender |
| **Aktives CRM** | Für jeden offenen Deal genau **eine nächste Aktion** mit Begründung („Angebot nachfassen“, „Auf Kundenantwort reagieren“), Wartezustand („Wir sind am Zug“ / „Warten auf Kunde“), Momentum, geplante Automationen (z. B. Nachfassen nach X Tagen), die automatisch entfallen, sobald der Kunde antwortet |
| Workflows | Auslöser (Datensatz erstellt, Feld/Phase/Status geändert, Aufgabe überfällig) → Bedingungen → Aktionen |
| Akquise | Prospects, E-Mail-Sequenzen, Einstufung von Antworten, Sperrliste |
| E-Mail | Vorlagen, Versand über SMTP |
| Auswertung | Funnel, Forecast, Quellen, Zykluszeiten |
| Nachvollziehbarkeit | Audit-Log, Aufrufprotokoll der Mailwin-Schnittstelle |

---

## 2. Abläufe

Die Wirkung im CRM entsteht nicht durch „Felder setzen“, sondern durch das
**aktive CRM**: Mailwin meldet, was passiert ist, und das CRM leitet daraus
Phase, Wartezustand, nächste Aktion und Automationen ab.

### A — Neue Anfrage

1. `GET /contacts?email=<absender>` → bekannt? Firma? offene Leads?
2. Kein offener Lead passt → `POST /leads` (Kontakt und Firma entstehen bei Bedarf).
3. Die Anfrage selbst → `POST /activities` mit `leadId` (Typ `email`, `inbound`).

### B — Nachricht von einem Bestandskunden

1. `GET /contacts?email=<absender>` → Kontakt gefunden, ggf. mit `openLeads`.
2. Gehört die Nachricht zu einem offenen Lead → `POST /activities` **mit
   `leadId`**. Gehört sie zu keinem → nur mit `contactId`. Ist es eine **neue**
   Anfrage (Nachbestellung, Erweiterung) → `POST /leads`; der bestehende Kontakt
   wird wiederverwendet.
3. Neue Angaben in der Signatur (Telefon, Position) → `POST /contacts/{id}/suggestions`:
   leere Felder werden gefüllt, Abweichungen werden zum Vorschlag im CRM.

**Wirkung einer eingehenden Nachricht mit `leadId`:** „Kunde hat geantwortet“ —
geplante Nachfass-Automationen stoppen, automatisch erzeugte Nachfass-Aufgaben
werden geschlossen, nächste Aktion „Auf Kundenantwort reagieren“. Ohne `leadId`
landet die Nachricht nur in der Zeitleiste des Kontakts.

### C — Wir schicken ein Angebot

Mailwin erkennt in einer **ausgehenden** Mail ein Angebot →
`POST /leads/{id}/signals` mit `signal: "offer_sent"` (am besten mit
`data.valueCents` und `data.offerNumber`).

**Wirkung:** Phase → **Angebot** (nur vorwärts), „Angebot gesendet“ in der
Zeitleiste, nächste Aktion **„Angebot nachfassen“** nach der im CRM
eingestellten Frist. Ein leerer Lead-Wert wird aus dem Angebot übernommen; weicht
ein vorhandener Wert ab, erscheint der Vorschlag **„Wert auf 24.000 €
aktualisieren?“** — von Hand gepflegte Werte werden nie still überschrieben.

### D — Kunde nimmt per E-Mail an (oder lehnt ab)

`POST /leads/{id}/signals` mit `offer_accepted` (bzw. `offer_declined`), mit
`evidence.quote` und `evidence.confidence`.

**Wirkung (Standard):** Das geplante Nachfassen entfällt, und am Lead erscheint
der Vorschlag **„Als gewonnen markieren?“** (bzw. „Als verloren markieren?“ mit
Grund) — mit Zitat, Verlässlichkeit und Link zur Nachricht. Der Vorschlag ist
zugleich die nächste Aktion und steht damit in „Heute“. Ein Klick auf
**Übernehmen** setzt den Lead auf Gewonnen; das löst `lead.won` an Mailwin aus.
Wer möchte, stellt im CRM auf **automatisch** um — dann ab einer
Mindest-Verlässlichkeit (Standard 90 %) **und nur mit wörtlichem Zitat**;
darunter oder ohne Zitat bleibt es ein Vorschlag. Ob ein Mensch einen Vorschlag
übernimmt oder verwirft, meldet das CRM per `signal.proposal_resolved` zurück.
Für Verträge gilt dasselbe mit `contract_sent` (Phase → Verhandlung) und
`contract_accepted`.

### E — Termine, Rückfragen, Abwesenheit

| Mailwin erkennt … | Aufruf | Wirkung |
| --- | --- | --- |
| Terminwunsch | signal `meeting_requested` | nächste Aktion „Termin vereinbaren“ |
| Termin bestätigt | signal `meeting_booked` mit `data.startAt` | Termin im Kalender, Phase → Termin, „Termin vorbereiten“ |
| Rückfrage | signal `question` | nächste Aktion „Rückfrage beantworten“ |
| Abwesenheitsnotiz | signal `out_of_office` mit `data.until` | Automationen pausieren bis zur Rückkehr — ausdrücklich **keine** Kundenantwort |
| „Rufen Sie mich Dienstag an“ | `POST /tasks` mit `externalId` | Aufgabe für den Owner des Leads (dieselbe `externalId` legt nie eine zweite an) |
| Signatur mit Telefon, Position, Adresse | `POST /contacts/{id}/suggestions` | leere Felder füllen, Abweichungen als Vorschlag |

### F — Wir schreiben dem Kunden

`POST /activities` mit `direction: "outbound"` und `leadId` → das CRM vermerkt
unseren letzten Kontakt. Bleibt eine Antwort aus, schlägt es nach einigen Tagen
„Nachfassen“ vor, sofern für die Phase kein eigener Schritt hinterlegt ist.

### G — Antwort mit Kontext vorbereiten

`GET /leads/{id}` liefert Owner, Phase, Wert, Kontakte, nächste Aktion, offene
Aufgaben, die letzten fünf Aktivitäten und offene Vorschläge — genug, damit ein
Entwurf zum Stand im CRM passt.

### H — Nachfassen zur richtigen Zeit

Webhook **`lead.next_action_changed`**: Sobald das CRM für einen Lead eine neue
nächste Aktion festlegt (z. B. „Angebot nachfassen“, fällig am 10.11.), bekommt
Mailwin sie mit `dueAt`. Ist sie **fällig**, kommt **`lead.next_action_due`** —
genau einmal je Aktion und Termin, nur für Schritte mit Kundenkontakt
(Nachfassen, Angebot nachfassen, Termin vereinbaren/bestätigen, Reaktivieren).
Mailwin legt daraus im zugeordneten Thread einen Nachfass-**Entwurf zur
Freigabe** an, ohne automatischen Versand. Dazu wie bisher
`lead.stage_changed`, `lead.won`, `lead.lost`, `contact.updated` und neu
`lead.deleted` und `contact.merged`.

### I — Akquise-Antworten einstufen

Antworten auf Akquise-Sequenzen des CRM → `POST /outreach/replies` mit
Mailwins Einstufung (`interested`, `question`, `meeting_request`, `later`,
`referral`, `not_interested`, `out_of_office`, `unsubscribe`, `unknown`) und
Verlässlichkeit. Mit `inReplyTo` und `references` ordnet das CRM die Antwort
genau der versendeten Sequenz-Mail zu — auch wenn jemand anderes antwortet
(Assistenz, Vertretung). Das ersetzt die Schlüsselwort-Regel des CRM; die Folgen sind
dieselben (Sequenz anhalten, Prospect umstufen, Abmeldung sperren — eine
Abwesenheitsnotiz hält nichts an).

---

## 3. Signale im Detail

```http
POST /api/mailwin/v1/leads/{leadId}/signals
Idempotency-Key: signal:a5c7e9b1-3d5f-4a7c-8e0b-2d4f6a8c0e25:offer_sent

{
  "signal": "offer_sent",
  "occurredAt": "2026-11-03T10:12:00+01:00",
  "externalId": "email:a5c7e9b1-3d5f-4a7c-8e0b-2d4f6a8c0e25",
  "url": "https://okun-mailwin.com/emails/7d1f3c2a-5b8e-4f6a-9c0d-2e4b6a8c1f30#m-a5c7e9b1-3d5f-4a7c-8e0b-2d4f6a8c0e25",
  "summary": "Angebot Nr. 2026-117 über 24.000 € als PDF verschickt.",
  "evidence": { "quote": "anbei unser Angebot für die Wartung …", "confidence": 0.93 },
  "data": { "offerNumber": "2026-117", "valueCents": 2400000 }
}
```

Antwort (`201`, bei Wiederholung `200` mit `duplicate: true`):

```json
{
  "signal": "offer_sent",
  "duplicate": false,
  "applied": ["timeline", "stage_changed:Angebot", "value_updated", "offer_follow_up"],
  "proposed": [],
  "ignored": [],
  "lead": {
    "id": "cmvv4dngx000bwq7d989hmq3m",
    "url": "https://crm.example.com/deals/cmvv4dngx000bwq7d989hmq3m",
    "status": "open",
    "stage": { "id": "…", "name": "Angebot" },
    "valueCents": 2400000,
    "nextAction": { "type": "chase_offer", "title": "Angebot nachfassen", "dueAt": "2026-11-10T09:12:00.000Z" },
    "operationalState": "waiting_for_customer"
  }
}
```

- `applied`: was ausgeführt wurde — `timeline`, `stage_changed:<Phase>`,
  `value_updated`, `offer_follow_up`, `meeting_created`, `next_action_set`,
  `automation_paused`, `won`, `lost`.
- `proposed`: Vorschläge, die ein Mensch bestätigt (`deal.mark_won`,
  `deal.mark_lost`, `deal.update_value`). Ihre `id` kommt in
  `signal.proposal_resolved` als `proposalId` zurück.
- `ignored`: was bewusst nicht geschah, als `code: Erklärung` — z. B.
  `stage: …nur vorwärts`, `won: ohne wörtliches Zitat — deshalb nur ein Vorschlag`,
  `lead_closed: …`.
- `evidence.quote` höchstens 300 Zeichen, wörtlich aus der Nachricht.

**Regeln, die immer gelten:** Phasen nur vorwärts; ein gewonnener oder
verlorener Lead wird nur noch protokolliert; Gewonnen/Verloren standardmäßig nur
als Vorschlag; welche Phase ein Signal auslöst, legt der Kunde je Pipeline fest
(Einstellungen → Integrationen → Mailwin → Signale), ohne Zuordnung bleibt die
Phase; alles steht „über Mailwin“ mit Zitat und Link in der Zeitleiste;
idempotent über `signal` + `externalId`. Eine automatische Phasenänderung nimmt
man im CRM wie gewohnt über die Phasenleiste zurück.

---

## 4. Was Mailwin dafür braucht bzw. liefern sollte

1. **Ausgehende Mails sehen** — sonst ist `offer_sent` nicht erkennbar.
2. **Stabile IDs** je Nachricht (`messageId`) und Thread (`threadId`) — für
   Idempotenz und die Links „In Mailwin öffnen“.
3. **Eine Verlässlichkeit (0–1)** je Erkennung und ein kurzes **Zitat** als Beleg —
   das CRM zeigt beides beim Vorschlag an.
4. **Zuordnung zum Lead:** Mailwin merkt sich je Thread die `leadId` (aus
   `POST /leads` oder `openLeads`), damit Folge-Nachrichten und Signale am
   richtigen Lead landen.

## 5. Entschieden

- **Mailwin-Seite (beantwortet):** Angebote erkennt Mailwin zweistufig (Vorfilter
  über Anhangname und Formulierungen, dann Einordnung durch das Sprachmodell);
  Verlässlichkeiten sind anfangs unkalibrierte Schätzwerte, gesendet wird ab 0,6;
  WhatsApp-IDs sind stabil (`externalId` = `whatsapp:<id>`).
- **OKUN:** „Angebot angenommen“ ist standardmäßig ein **Vorschlag**;
  „automatisch gewonnen“ lässt sich je Arbeitsbereich einschalten und greift nur
  mit Zitat. Ein abweichender Angebotswert wird zum Vorschlag (Einstellung
  „Wert aus dem Angebot“; alternativ nur leere Werte füllen).
