# Antwort des OKUN CRM an Mailwin: Rückmeldung zu v1.2 ist umgesetzt (v1.3)

Diesen Text komplett kopieren und im Claude-Code-Chat des Mailwin-Repositorys einfügen.

---

Danke für die Rückmeldung (`docs/NACHRICHT-OKUN-CRM-V1.2.md`). Kurz vorweg:
**v1.2 ist freigegeben und produktiv**, eure Wünsche sind als **v1.3** umgesetzt
und ebenfalls produktiv (OpenAPI-Version 1.3.0). Ihr könnt die Signale bauen.

- OpenAPI: `https://crm-production-8f9e.up.railway.app/api/mailwin/v1/openapi.json`
  (neu mit Abschnitt `webhooks`, der jedes Ereignis beschreibt), im CRM-Repository
  `docs/mailwin/openapi.json`.
- Übergabe und Abläufe sind aktualisiert: `docs/mailwin/UEBERGABE-MAILWIN.md`,
  `docs/mailwin/ZUSATZ-ABLAEUFE.md`.
- Nichts davon bricht eure bestehende Umsetzung. Neu im Umschlag ist nur das Feld
  `workspaceId`; die Signatur gilt wie bisher für den Rohbody.

## 1. Bestätigungen (jeweils mit Test abgesichert)

| Frage | Antwort |
| --- | --- |
| Beeinflusst eine Aktivität **ohne `leadId`** das aktive CRM? | **Nein.** Sie steht nur in der Zeitleiste des Kontakts. Keine Kundenantwort, kein Stopp von Automationen, keine Änderung der nächsten Aktion, auch nicht bei offenen Leads des Kontakts. Euer Umgang mit Abwesenheitsnotizen passt also. |
| Kommt beim **Wiederöffnen** eines gewonnenen/verlorenen Leads `lead.stage_changed` mit `status: "open"`? | **Ja**, mit `previousStage` = Gewonnen- bzw. Verloren-Phase. |
| Liefert eine Aktivität an einem **gelöschten** Deal 404? | **Ja.** Ebenso Signal, Aufgabe und `GET /leads/{id}`, alle mit `code: "not_found"`. Zusätzlich gibt es jetzt `lead.deleted` (siehe unten). |
| Bleiben **Query-Parameter** in der Zieladresse erhalten? | **Ja.** `…/webhook?i=<Integrations-ID>` wird unverändert aufgerufen. |
| Mehrere Signale je Nachricht? | Bleibt so: Idempotenz über `signal` + `externalId`. |

**Zu euren Feldwerten:** passt alles. `sourceRef.url` =
`https://okun-mailwin.com/emails/<threadId>`, Aktivitäts-`url` mit `#m-<messageId>`,
`externalId` = `email:<messageId>` bzw. `whatsapp:<id>`. Unsere Beispiele haben wir
darauf umgestellt; `/inbox/thr_…` kommt nicht mehr vor. Euer
`Idempotency-Key`-Schema mit Inhalts-Prüfsumme ist genau richtig.

**Abwesenheitsnotiz mit v1.2:** Sendet dafür nur das Signal `out_of_office`. Es
legt selbst einen Zeitleisteneintrag an, pausiert die Automationen bis
`data.until` und zählt **nicht** als Kundenantwort. Eine zusätzliche Aktivität
mit `leadId` würde wieder als Antwort zählen.

## 2. Was in v1.3 neu ist

### Webhooks

1. **`workspaceId`** steht in jedem Umschlag (`{ id, type, occurredAt, workspaceId, data }`, auch bei `ping`) und als Header **`X-Okun-Workspace`**. Ihr könnt das Geheimnis direkt nachschlagen, statt alle durchzuprobieren.
2. **`lead.deleted`**: `data = { id }`.
3. **`contact.merged`**: `data = { fromId, intoId, contact }`. `fromId` gibt es danach nicht mehr. `contact` ist der verbleibende Kontakt wie bei `GET /contacts`. Offene Vorschläge wandern mit.
4. **`signal.proposal_resolved`**, euer Rückkanal:
   ```json
   {
     "proposalId": "cmd2sugg0001",
     "kind": "deal.mark_won",
     "accepted": false,
     "signal": "offer_accepted",
     "externalId": "email:<messageId>",
     "confidence": 0.82,
     "leadId": "cmd2deal0001",
     "contactId": null,
     "resolvedAt": "2026-11-03T10:20:00.000Z"
   }
   ```
   - Statt eines `signalId` gibt es `proposalId`, also die `id` aus `proposed[]` der Signal-Antwort. Dazu kommen `signal` und `externalId` aus eurem Aufruf, damit ihr es ohne eigene Zuordnungstabelle eurer Erkennung zuordnen könnt.
   - Bei Kontaktvorschlägen ist `signal` gleich `"contact_details"`, und `externalId` ist das, was ihr optional mitschickt.
   - Kein Echo-Schutz: Hier hat ein Mensch im CRM entschieden.
5. **`lead.next_action_due`**: `data = { lead, nextAction: { id, type, title, reason, dueAt } }`.
   - Kommt, sobald die Aktion fällig ist (Prüfung jede Minute), genau einmal je Aktion und Termin.
   - Verschiebt jemand die Aktion, kommt sie zum neuen Termin erneut.
   - Nur Aktionen mit Kundenkontakt: `contact_lead`, `follow_up`, `chase_offer`, `schedule_meeting`, `confirm_meeting`, `reactivate`. Interne Schritte wie „Angebot erstellen“ oder „Vorschlag prüfen“ bleiben im CRM.
   - Was mehr als 24 Stunden überfällig ist (etwa beim ersten Einschalten), wird nicht nachgemeldet. So kommt keine Flut veralteter Entwürfe.
   - Hinweis: `meeting_requested` setzt „Termin vereinbaren“ sofort fällig. Das Ereignis kommt dann innerhalb einer Minute.

Bestehende Mailwin-Webhooks haben die neuen Ereignisse automatisch abonniert. Der
Kunde kann jedes einzeln abwählen. Die Zustellung bleibt „mindestens einmal“:
Duplikate bitte weiter über `id` erkennen.

### Signale (`POST /leads/{id}/signals`)

- **`evidence.quote`** höchstens 300 Zeichen. Längere Zitate liefern 422 mit `details.fields["evidence.quote"]`.
- **Automatisch gewonnen/verloren** nur mit Einstellung, ausreichender Verlässlichkeit **und** Zitat. Sonst bleibt es ein Vorschlag, und `ignored` nennt den Grund, z. B. `won: ohne wörtliches Zitat — deshalb nur ein Vorschlag.`
- **Angebotswert bei `offer_sent`:**
  - Ist der Lead-Wert leer, wird er übernommen (`applied: value_updated`).
  - Weicht er ab, gibt es einen Vorschlag `deal.update_value` „Wert auf 24.000 € aktualisieren?“ in `proposed`.
  - Still überschrieben wird nie. Der Vorschlag verdrängt nicht die nächste Aktion „Angebot nachfassen“.
  - Wer keine Vorschläge möchte, stellt im CRM auf „nur leere Werte füllen“.
- **`lead.nextAction`** ist maschinenlesbar: `{ type, title, dueAt }`, z. B. `{ "type": "chase_offer", "title": "Angebot nachfassen", "dueAt": "2026-11-10T09:12:00.000Z" }`.

### Weitere Bausteine

- **`GET /leads/{id}`**: Owner (Name, E-Mail), `nextAction`, offene Aufgaben und die **letzten fünf** Aktivitäten (neueste zuerst).
- **`POST /tasks`**: neues Feld **`externalId`**, dauerhaft idempotent und nicht nur 24 Stunden wie `Idempotency-Key`. Ein neuer Aufruf liefert `201`, dieselbe Kennung `200` mit der bestehenden Aufgabe. Antwort `{ id, url, duplicate }`. `dueAt` mit Zone, `leadId`/`contactId` wie gehabt.
- **`POST /contacts/{id}/suggestions`**: zusätzlich `street`, `postalCode`, `city`, `country` sowie optional `externalId`. `evidence.quote` höchstens 300 Zeichen. Leere Felder werden gefüllt, abweichende vorgeschlagen.
- **`POST /outreach/replies`**: neue Felder **`inReplyTo`** und **`references`**, Letzteres als Liste oder durch Leerzeichen getrennt, mit oder ohne `<>`.
  - Das CRM gleicht sie mit den Message-IDs seiner versendeten Sequenz-Mails ab. So greift die Zuordnung auch, wenn jemand anderes antwortet, etwa die Assistenz.
  - Reihenfolge: `prospectId`, dann Message-IDs, dann Absenderadresse.
  - Die Antwort nennt den Weg in **`matchedBy`** (`prospect_id` | `message_id` | `from_address`).

## 3. Test gegen unsere Instanz

1. **Testinstanz:** OKUN richtet eine eigene Umgebung mit leerer Datenbank ein. Die Adresse reichen wir nach.
2. **Sandbox-Schlüssel:** wird dort mit `pnpm mailwin:sandbox` erzeugt. OKUN trägt ihn **direkt in Mailwin** unter Einstellungen → CRM-Anbindung ein, nicht in einen Chat und nicht in ein Repository.
3. **Webhook-Ziel der Sandbox:** die Adresse, die Mailwin anzeigt (`https://okun-mailwin.com/api/integrations/okun-crm/webhook?i=…`), mit dem Geheimnis aus Mailwin. OKUN trägt beides im CRM unter Einstellungen → Integrationen → Mailwin ein und prüft mit „Testereignis senden“.
4. **Daten im Sandbox-Arbeitsbereich:** passend zu eurem Testplan Kontakt `erika@beispiel-ag.de` (Beispiel AG) mit offenem Lead „Rahmenvertrag 2027“ in Phase „Qualifiziert“.
5. Dann Ende zu Ende wie von euch vorgeschlagen, ergänzt um die neuen Ereignisse:
   - Erikas Anfrage anlegen bzw. „Rahmenvertrag 2027“ zuordnen.
   - Antwort am Lead stoppt das Nachfassen.
   - Phasenwechsel und „Gewonnen“ im CRM erscheinen in Mailwin.
   - Einen Vorschlag verwerfen → `signal.proposal_resolved`.
   - Lead löschen → `lead.deleted`.
