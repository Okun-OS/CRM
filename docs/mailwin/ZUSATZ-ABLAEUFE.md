# Zusatz für Mailwin: Was das CRM kann und wie Mailwin es nutzen kann

Ergänzung zur [Übergabe](UEBERGABE-MAILWIN.md). Sie beantwortet drei Fragen:
Was kann OKUN CRM? Was kann Mailwin mit der API v1 **heute** schon auslösen?
Welche Abläufe sind als **v1.2 vorgeschlagen** (noch nicht gebaut) — und was
muss Mailwin dafür liefern?

> Kennzeichnung: **✅ heute verfügbar** · **🧩 Vorschlag v1.2, noch nicht verfügbar**.
> Gegen 🧩 bitte noch nicht bauen — Rückmeldung zum Entwurf ist ausdrücklich erwünscht.

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

## 2. Was Mailwin heute schon auslösen kann ✅

Die Wirkung im CRM entsteht nicht durch „Felder setzen“, sondern durch das
**aktive CRM**: Mailwin meldet, was passiert ist, und das CRM leitet daraus
Wartezustand, nächste Aktion und Automationen ab.

### Ablauf A — Neue Anfrage

1. `GET /contacts?email=<absender>` → bekannt? Firma? offene Leads?
2. Kein offener Lead passt → `POST /leads` (Kontakt und Firma entstehen bei Bedarf).
3. Die Anfrage selbst → `POST /activities` mit `leadId` (Typ `email`, `inbound`).

**Wirkung:** Lead in der ersten Phase, Nachricht in der Zeitleiste, nächste
Aktion für den Owner. Bei aktivem Webhook bekommt Mailwin später jeden
Phasenwechsel.

### Ablauf B — Nachricht von einem Bestandskunden

1. `GET /contacts?email=<absender>` → Kontakt gefunden, ggf. mit `openLeads`.
2. Gehört die Nachricht zu einem offenen Lead → `POST /activities` **mit `leadId`**
   (und `contactId`).
   Gehört sie zu keinem → `POST /activities` nur mit `contactId`.
   Ist es eine **neue** Anfrage (Nachbestellung, Erweiterung) → `POST /leads`; der
   bestehende Kontakt wird wiederverwendet, nicht doppelt angelegt.

**Wirkung einer eingehenden Nachricht mit `leadId`:** Das CRM vermerkt „Kunde hat
geantwortet“, **stoppt geplante Nachfass-Automationen** für diesen Lead, schließt
die automatisch erzeugten Nachfass-Aufgaben und setzt die nächste Aktion auf
„Auf Kundenantwort reagieren“ (Zustand „Wir sind am Zug“). Gilt für E-Mail und
WhatsApp gleichermaßen.

> Wichtig: Ohne `leadId` landet die Nachricht nur in der Zeitleiste des Kontakts —
> das aktive CRM reagiert dann nicht. Mailwin sollte die Nachricht deshalb dem
> passenden offenen Lead zuordnen (aus `openLeads` von `GET /contacts`).

### Ablauf C — Wir schreiben dem Kunden

`POST /activities` mit `direction: "outbound"` und `leadId` → das CRM vermerkt
den letzten Kontakt von unserer Seite. Bleibt eine Antwort aus, schlägt es nach
einigen Tagen „Nachfassen“ vor (Zustand „Warten auf Kunde“), sofern für die
aktuelle Phase kein eigener nächster Schritt hinterlegt ist.

### Ablauf D — Rückmeldungen an Mailwin

Webhooks `lead.stage_changed`, `lead.won`, `lead.lost`, `contact.updated`
(siehe Übergabe). Damit kann Mailwin z. B. einen Thread als „gewonnen“
markieren oder Kontaktdaten aktualisieren.

### Was heute **nicht** geht

- Mailwin kann die **Phase** eines Leads nicht ändern und kein Angebot als
  „versendet“ oder „angenommen“ melden.
- Mailwin kann bestehende Kontaktdaten nicht **ändern**, nur leere Felder füllen.
- Mailwin kann keine Aufgaben anlegen und keine Antworten auf Akquise-Sequenzen
  einstufen.

Genau dafür ist v1.2 gedacht.

---

## 3. Vorgeschlagen für v1.2 🧩 (noch nicht gebaut)

### 3.1 Signale zu einem Lead — der Kern

```http
POST /api/mailwin/v1/leads/{leadId}/signals
Idempotency-Key: signal:msg_9002:offer_sent

{
  "signal": "offer_sent",
  "occurredAt": "2026-11-03T10:12:00+01:00",
  "externalId": "msg_9002",
  "url": "https://okun-mailwin.com/inbox/thr_9001#msg_9002",
  "summary": "Angebot Nr. 2026-117 über 24.000 € als PDF verschickt.",
  "evidence": { "quote": "anbei unser Angebot für die Wartung …", "confidence": 0.93 },
  "data": { "offerNumber": "2026-117", "valueCents": 2400000, "validUntil": "2026-11-30" }
}
```

Mailwin meldet, **was es erkannt hat**; das CRM entscheidet nach den Regeln des
Arbeitsbereichs, **was daraus folgt**:

| Signal | Mailwin erkennt … | Folge im CRM (Standard) |
| --- | --- | --- |
| `offer_sent` | ausgehende Mail mit Angebot (Anhang/Text) | Phase → **Angebot** (nur vorwärts), „Angebot gesendet“ in der Zeitleiste, Automation **„Angebot nachfassen“** nach X Tagen; optional Wert aus `data.valueCents` übernehmen |
| `offer_accepted` | Kunde nimmt per E-Mail an („Wir nehmen das Angebot an“) | **Vorschlag** „Als gewonnen markieren?“ mit Zitat — ein Klick im CRM; wahlweise automatisch **Gewonnen** |
| `offer_declined` | Kunde sagt ab | **Vorschlag** „Als verloren markieren?“ mit Grund aus der Mail |
| `meeting_requested` | Kunde möchte einen Termin | nächste Aktion „Termin vereinbaren“ |
| `meeting_booked` | Termin bestätigt (`data.startAt`) | Phase → **Termin** (nur vorwärts), Termin in der Zeitleiste, „Termin vorbereiten“ vor dem Termin |
| `question` | Rückfrage des Kunden | nächste Aktion „Frage beantworten“ |
| `out_of_office` | Abwesenheitsnotiz (`data.until`) | Nachfass-Automationen **pausieren bis** zum Rückkehrdatum — ausdrücklich **keine** Kundenantwort |
| `contract_sent` / `contract_accepted` | Vertrag versendet / unterschrieben zurück | wie Angebot, Phase → **Verhandlung** bzw. Vorschlag **Gewonnen** |

Regeln, die immer gelten:

- **Nur vorwärts:** Ein Signal verschiebt nie zurück und öffnet nie einen gewonnenen
  oder verlorenen Lead wieder.
- **Gewonnen/Verloren standardmäßig nur als Vorschlag.** Eine falsch erkannte
  Zusage darf keinen Umsatz in den Forecast schreiben. Wer möchte, stellt im CRM
  auf „automatisch“ um (z. B. ab `confidence ≥ 0.9`).
- **Phasen über Zuordnung, nicht über Namen:** Im CRM legt der Kunde je Pipeline
  fest, welches Signal in welche Phase führt (vorbelegt für die Standard-Pipeline).
  Gibt es keine Zuordnung, ändert sich die Phase nicht — das Signal wirkt trotzdem
  auf Zeitleiste und nächste Aktion.
- **Alles sichtbar und umkehrbar:** Jede Folge steht „über Mailwin“ in der
  Zeitleiste, mit Zitat und Link zur Nachricht, und lässt sich mit einem Klick
  zurücknehmen.
- **Idempotent** über `externalId` + `signal`.

Antwort (Vorschlag) — damit Mailwin dem Nutzer zeigen kann, was passiert ist:

```json
{
  "applied": ["timeline", "stage:Angebot", "automation:offer_chase"],
  "proposed": [],
  "lead": { "id": "cmvv4dngx000bwq7d989hmq3m", "stage": "Angebot", "status": "open", "nextAction": "Angebot nachfassen am 10.11.2026" }
}
```

### 3.2 Weitere Bausteine

| Vorschlag | Zweck |
| --- | --- |
| `GET /leads/{id}` | Kontext für Antwortentwürfe: Phase, Wert, nächste Aktion, offene Aufgaben, letzte Aktivitäten |
| `POST /tasks` | „Bitte rufen Sie mich Dienstag an“ → Aufgabe mit Fälligkeit für den Owner |
| `POST /contacts/{id}/suggestions` | Neue Telefonnummer oder Position aus der Signatur → **Vorschlag** zur Übernahme im CRM statt stillem Überschreiben |
| `POST /outreach/replies` | Mailwin stuft Antworten auf Akquise-Sequenzen ein (interessiert, Frage, Termin, später, Weiterleitung, kein Interesse, abwesend, abmelden) mit Verlässlichkeit. Das CRM ersetzt damit seine heutige Schlüsselwort-Einstufung; Abmeldungen landen sofort auf der Sperrliste, Sequenzen stoppen. |
| Webhook `lead.next_action_due` | Das CRM meldet „Angebot nachfassen ist fällig“ → Mailwin legt einen Nachfass-Entwurf im richtigen Thread an |

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

## 5. Offene Punkte

- **Mailwin-Seite:** Wie erkennt Mailwin ein Angebot (Anhangname, Schlagwörter,
  Modell)? Welche Verlässlichkeitswerte sind realistisch? Gibt es WhatsApp-IDs,
  die stabil wie `messageId` sind?
- **OKUN-Seite (Produktentscheidung, noch offen):** Soll „Angebot angenommen“
  standardmäßig nur ein Vorschlag sein oder direkt **Gewonnen** setzen? Soll
  `offer_sent` den Deal-Wert überschreiben dürfen?
