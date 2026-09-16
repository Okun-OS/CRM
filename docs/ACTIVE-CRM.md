# Aktives CRM — Next Action Engine

> Ein CRM sollte keine zusätzliche Arbeit machen. Es sollte Arbeit übernehmen.

Diese Ebene liegt **auf** dem CRM-Kern, nicht daneben: Kontakte, Unternehmen,
Leads, Deals, Pipelines, Aktivitäten und Aufgaben bleiben unverändert. Ergänzt
wird, was daraus folgt — was als Nächstes zu tun ist, worauf ein Vorgang
wartet, was das System selbst erledigt und warum.

---

## 1. Die drei Zusagen

| Prinzip | Was es konkret bedeutet |
| --- | --- |
| **Aktiv** | Jeder offene Deal und Lead trägt eine nächste Aktion mit Fälligkeit, Verantwortlichem und Begründung. |
| **Ohne Verwaltungsaufwand** | Timeline, Warte-Zustand und laufende Automationen ergeben sich aus dem, was tatsächlich passiert; niemand pflegt sie nach. |
| **Nachvollziehbar** | Jede Empfehlung nennt die Regel und den Grund. Es gibt keine geschätzte Abschlusswahrscheinlichkeit, keinen Lead-Score, kein Modell, das nicht erklärbar wäre. |

---

## 2. Ablauf

```
Ereignis  →  Kontext       →  Regel          →  Nächste Aktion  →  Ausführung    →  Ergebnis
(recordEvent) (loadSubject)   (evaluateRules)   (reconcile)        (runAutomation)  (Aktivität,
                                                                                    Aufgabe,
                                                                                    Ereignis)
```

Jeder Schritt ist ein eigenes Modul unter `src/server/engine/`:

| Datei | Aufgabe |
| --- | --- |
| `events.ts` | Ereignisse aufnehmen (idempotent) und ihre Folgen anwenden |
| `effects.ts` | Tabelle: welches Ereignis bedeutet was (Timeline, Felder, Abbrüche) |
| `subject.ts` | Momentaufnahme eines Datensatzes laden — der einzige Datenbankzugriff der Entscheidung |
| `rules.ts` | Regelkatalog als Entscheidungstabelle |
| `momentum.ts` | Momentum aus sichtbaren Signalen |
| `next-actions.ts` | Abgleich: Vorschlag ↔ gespeicherter Zustand |
| `follow-ups.ts` | Welche Empfehlungen automatisiert werden dürfen |
| `guards.ts` | Sicherheitsprüfungen unmittelbar vor der Ausführung |
| `automations.ts` | Geplante Automationen ausführen |
| `sweep.ts` | Der periodische Durchlauf (Fälligkeiten, Stagnation) |
| `bridge.ts` | Übersetzung der bestehenden Domänenereignisse in Engine-Ereignisse |
| `settings.ts` | Organisationsweite Schwellen und Regel-Overrides |

---

## 3. Ereignismodell

Alles, worauf das System reagiert, wird zuerst als `DomainEventRecord`
geschrieben und erst dann verarbeitet. Das liefert drei Dinge:

- **Idempotenz.** `@@unique([organizationId, idempotencyKey])` — eine doppelte
  Zustellung aus einem anderen System wird bestätigt, aber nicht zweimal
  angewendet.
- **Nachvollziehbarkeit.** Am Datensatz lässt sich lesen, welches Ereignis
  welche Änderung ausgelöst hat.
- **Eine Erweiterungsstelle.** Neue Quellen schreiben Ereignisse, statt in
  Services einzugreifen.

Ereignisse entstehen auf drei Wegen:

1. **Aus dem Produkt heraus** — `bridge.ts` übersetzt die bestehenden
   Domänenereignisse (`deal.created`, `deal.stage_changed`, `lead.created`, …).
2. **Aus erfasster Arbeit** — eine protokollierte E-Mail, ein Anruf, eine Notiz,
   ein Terminstatus.
3. **Von außen** — `POST /api/v1/ingest/events` mit API-Key (Abschnitt 9).

Verarbeitungsfehler landen in `processingError` am Ereignis; die auslösende
Aktion scheitert deswegen nie.

### Wirkungstabelle (`effects.ts`)

Jedes Ereignis kann vier Dinge auslösen. Neues Verhalten ist eine neue Zeile,
keine weitere Verzweigung in einem Service.

| Ereignis | Timeline | Feld | Bricht ab | Schließt Aufgaben |
| --- | --- | --- | --- | --- |
| `EMAIL_SENT` | E-Mail ausgehend | `lastOutboundAt` | — | — |
| `EMAIL_RECEIVED` | E-Mail eingehend | `lastCustomerResponseAt` | alle Follow-ups | ja |
| `CUSTOMER_REPLIED` | Antwort erkannt | `lastCustomerResponseAt` | alle Follow-ups | ja |
| `CALL_LOGGED` | Anruf | `lastOutboundAt` | — | — |
| `MEETING_BOOKED` | Termin gebucht | `nextMeetingAt` | alle Follow-ups | ja |
| `MEETING_COMPLETED` | Termin stattgefunden | `nextMeetingAt = null` | — | — |
| `OFFER_SENT` | Angebot gesendet | `offerSentAt`, `lastOutboundAt` | — | — |
| `CONTRACT_ACCEPTED` | Vertrag angenommen | `lastCustomerResponseAt` | alle | ja |
| `DEAL_WON` / `DEAL_LOST` | (Stage-Wechsel) | — | alle | ja |

Automatisch geschlossen werden ausschließlich Aufgaben, die die Engine selbst
erzeugt hat. Von Hand angelegte Aufgaben rührt das System nicht an.

---

## 4. Operativer Zustand

Neben der Pipeline-Stage — die sagt, *wo* ein Deal steht — trägt jeder Deal und
Lead einen operativen Zustand, der sagt, *worauf* er wartet:

| Zustand | Bedeutung |
| --- | --- |
| `WAITING_FOR_US` | Wir sind am Zug. |
| `WAITING_FOR_CUSTOMER` | Nachgefasst, Antwort steht aus. |
| `SCHEDULED` | Termin oder Wiedervorlage steht. |
| `NO_NEXT_ACTION` | **Kein nächster Schritt definiert** — wird als Mangel angezeigt, nicht verschwiegen. |
| `CLOSED` | Abgeschlossen; alles Offene wurde geschlossen. |

Beispiel: Stage `Angebot` + Zustand `WAITING_FOR_CUSTOMER` + nächste Aktion
`Angebot nachfassen` + fällig in zwei Tagen + Verantwortliche: Maria Nord.

**Wer ist am Zug?** Solange sich die Zeitstempel unterscheiden, entscheiden
sie. Von Hand erfasste Aktivitäten tragen jedoch häufig dieselbe Minute; dann
entscheidet die Reihenfolge, in der die Ereignisse aufgezeichnet wurden.

---

## 5. Regelkatalog

Regeln sind Daten, keine Verzweigungen. Sie werden von oben nach unten
ausgewertet, die erste zutreffende gewinnt, und jede liefert eine Begründung
im Klartext mit.

| # | Schlüssel | Trifft zu, wenn | Vorschlag |
| --- | --- | --- | --- |
| 1 | `customer_replied.respond` | Der Kunde hat zuletzt gesprochen | Auf Kundenantwort reagieren |
| 2 | `recall.due` | Eine Wiedervorlage ist gesetzt | Erneut melden |
| 3 | `meeting.prepare` | Ein Termin steht bevor | Termin vorbereiten |
| 4 | `meeting.follow_up` | Termin war, seitdem nichts | Nächsten Schritt festlegen |
| 5 | `offer.chase` | Angebot gesendet, keine Rückmeldung | Angebot nachfassen |
| 6 | `lead.qualify` | Lead hat reagiert | Lead qualifizieren |
| 7 | `lead.first_contact` | Lead nie kontaktiert | Erstkontakt |
| 8 | `stage.expected_action` | Die Stage hinterlegt eine Aktion | Die hinterlegte Aktion |
| 9 | `outbound.follow_up` | Nachricht raus, keine Antwort | Nachfassen |
| 10 | `stagnation.reactivate` | Länger als die Schwelle nichts passiert | Reaktivieren oder abschließen |
| 11 | `fallback.define_next_step` | **immer** | Keine nächste Aktion definiert |

Regel 11 ist die Garantie: Ein offener Datensatz bleibt nie ohne
nachvollziehbaren nächsten Schritt. Sie lässt sich nicht abschalten.

Regel 8 ist die konfigurierbare Stelle für eigene Vertriebsprozesse: An jeder
Pipeline-Stage lassen sich `expectedAction` und `expectedActionDays`
hinterlegen („Ein Deal in dieser Stage wartet auf ein Angebot, binnen fünf
Tagen").

Alle übrigen Regeln lassen sich je Organisation abschalten, in der Fälligkeit
verschieben (`delayDays`) oder in der Priorität überschreiben — unter
**Einstellungen → Aktives CRM**.

---

## 6. Abgleich (Reconciliation)

`reconcileSubject()` bringt den gespeicherten Zustand mit der Wirklichkeit in
Übereinstimmung. Es ist **idempotent**: ein zweiter Durchlauf ändert nichts.

1. Momentaufnahme laden. Ist der Datensatz abgeschlossen → alles Offene
   schließen, laufende Automationen mit Grund abbrechen, Ende.
2. Momentum berechnen.
3. Hat jemand eine Aktion von Hand gesetzt, gilt sie — die Engine stellt
   nichts daneben.
4. Sonst den Regelkatalog auswerten.
5. Stimmt der Vorschlag mit der gespeicherten Aktion überein, bleibt sie
   bestehen; sonst wird sie als `SUPERSEDED` abgelegt und eine neue erzeugt.
   Der Verlauf bleibt lesbar.
6. Denormalisierte Felder am Datensatz aktualisieren (für Listen und Board).
7. Geplante Automationen nachziehen.

Aufgerufen wird der Abgleich nach jedem Ereignis, nach jeder manuellen
Änderung und im periodischen Durchlauf.

---

## 7. Momentum

`HOCH`, `MITTEL`, `NIEDRIG`, `STAGNIERT` — als Summe benannter Signale, die
mit dem Datensatz gespeichert und in der Oberfläche vollständig angezeigt
werden:

| Signal | Gewicht |
| --- | --- |
| Kunde hat in den letzten 7 Tagen geantwortet | +2 |
| Termin geplant | +2 |
| Angebot frisch gesendet | +2 |
| Aktivität in den letzten 3 Tagen | +1 |
| Termin hat stattgefunden (≤ 14 Tage) | +1 |
| Noch keine Antwort des Kunden | −1 |
| Angebot ohne Rückmeldung über der Frist | −2 |
| Geplanter Abschluss überschritten | −2 |
| Keine Aktivität über der Stagnationsschwelle | −3 |

Stagnation ist eine Tatsache, kein Punktestand: Ohne jede Aktivität über der
Schwelle ist das Momentum `STAGNIERT`, unabhängig von allem anderen.

**Das ist keine Abschlusswahrscheinlichkeit.** Die Wahrscheinlichkeit am Deal
bleibt das, was Stage oder Benutzer gesetzt haben.

---

## 8. Automationen und ihre Sicherheitsprüfungen

Automatisiert werden derzeit **interne Erinnerungen** — eine Aufgabe für die
verantwortliche Person, wenn eine Aktion fällig wird. Ausgehende Nachrichten an
Kunden versendet das System nur, wenn eine E-Mail-Automation mit Vorlage
ausdrücklich eingerichtet wurde und ein E-Mail-Transport verbunden ist. Eine
falsche automatische Nachricht kostet mehr als eine verpasste Erinnerung.

Jede geplante Automation trägt ihre Bedingungen als `guards` mit sich und
**prüft sie unmittelbar vor der Ausführung erneut**:

| Guard | Ergebnis bei Verletzung |
| --- | --- |
| `record_open` | übersprungen: „Der Datensatz ist abgeschlossen." |
| `no_customer_response_since` | übersprungen: „Der Kunde hat inzwischen geantwortet." |
| `no_outbound_since` | übersprungen: „Es wurde inzwischen bereits nachgefasst." |
| `no_meeting_scheduled` | übersprungen: „Es ist bereits ein Termin vereinbart." |
| `automation_not_paused` | verschoben bis zum Ende der Pause |
| `within_working_hours` | verschoben auf den nächsten zulässigen Zeitpunkt |

Übersprungen ≠ still: Grund und Zeitpunkt stehen an der Automation und sind am
Datensatz sichtbar. Vor der Ausführung wird jede Automation beansprucht
(`claim`), sodass zwei parallele Durchläufe sie nicht doppelt ausführen.

---

## 9. Manuelle Übersteuerung

Der Mensch entscheidet, das System schlägt vor. Jede Übersteuerung landet in
Timeline und Audit-Log.

| Möglichkeit | Wirkung |
| --- | --- |
| Eigene nächste Aktion | Gilt vor jeder Regel, bis sie erledigt oder gelöscht ist |
| Verschieben | Aktion bleibt, wird zum gewählten Zeitpunkt wieder fällig |
| Empfehlung verwerfen | Nur mit Begründung; bleibt im Verlauf sichtbar |
| Wiedervorlage | „Melden Sie sich im November" — das System hält den Termin |
| Automation pausieren | Für diesen Datensatz passiert bis zum Enddatum nichts automatisch |
| Einzelne Automation stoppen | Mit Grund; wird nicht neu geplant, solange die Lage gleich bleibt |

---

## 10. Anbindung anderer OKUN-Produkte

OKUN Deals (Videocall → Angebot → Vertrag → Zahlung) meldet, was dort
geschieht; im CRM muss nichts doppelt erfasst werden.

```http
POST /api/v1/ingest/events
Authorization: Bearer okun_ck_…
Content-Type: application/json

{
  "events": [
    {
      "type": "OFFER_SENT",
      "idempotencyKey": "deals:offer:AN-4711:sent",
      "occurredAt": "2026-09-16T09:12:00Z",
      "target": { "contactEmail": "petra@sued.test" },
      "payload": { "reference": "AN-4711" }
    }
  ]
}
```

- **Der Mandant kommt aus dem API-Key**, nie aus dem Payload. Ein fremder
  Datensatz ist über keine Angabe im Body erreichbar.
- **Zuordnung:** `dealId`/`leadId` direkt, sonst über die Kontakt-E-Mail zum
  jüngsten offenen Deal, sonst zu einem offenen Lead.
- Findet sich nichts, meldet die Antwort `unmatched` — es wird nichts erfunden
  und kein Datensatz angelegt.
- Antwort je Ereignis: `accepted`, `duplicate` oder `unmatched`.

Zulässige Typen: Termine, Angebote, Verträge, Zahlungen, Anrufe, E-Mails und
Kundenantworten (`INGESTIBLE_EVENT_TYPES` in `src/server/services/ingestion.ts`).

OKUN Workforce bleibt ein eigenständiges Produkt; es gibt hier bewusst keine
Verschmelzung, sondern nur diese Schnittstelle.

---

## 11. Periodischer Durchlauf

Zeit allein ändert zwei Dinge: Eine Fälligkeit tritt ein, und ein Vorgang wird
still. Beides deckt der Sweep ab.

```http
POST /api/v1/scheduler/run
Authorization: Bearer okun_ck_…   # Scope scheduler:run
```

Er gleicht fällige und stille Datensätze ab, meldet neu erkannte Stagnation
einmal an die verantwortliche Person und führt aus, was fällig ist. Empfohlener
Takt: alle 15 Minuten. Siehe `docs/OPERATIONS.md`.

---

## 12. Konfiguration

**Einstellungen → Aktives CRM** (Recht `settings.manage`):

| Einstellung | Standard |
| --- | --- |
| Erstkontakt bei neuen Leads | 24 Stunden |
| Nachfassen ohne Antwort | 3 Tage |
| Angebot nachfassen | 5 Tage |
| Stagnation | 14 Tage |
| Terminvorbereitung | 24 Stunden vorher |
| Nächster Schritt nach dem Termin | 2 Tage |
| Ruhezeit | 20:00 – 07:00 Uhr |
| Nur an Werktagen | ja |
| Automationen ausführen | ja |

Ist „Automationen ausführen" aus, empfiehlt OKUN CRM weiterhin den nächsten
Schritt, führt aber nichts selbst aus. Die Werte liest die Engine zur Laufzeit;
eine zweite, verborgene Konfiguration gibt es nicht.

---

## 13. Was bewusst noch nicht gebaut ist

1. **Kein Worker.** Der Sweep braucht einen externen Auslöser (Cron, geplanter
   Job). Ohne ihn bleiben Fälligkeiten liegen, bis ein Ereignis eintrifft.
2. **Automatische Kunden-E-Mails** nur mit ausdrücklich eingerichteter Vorlage
   und verbundenem Transport — und einen E-Mail-Transport gibt es derzeit nicht
   (siehe `docs/ARCHITECTURE.md`, Abschnitt 13).
3. **Keine Ereignis-Wiederholung** (Replay) aus dem Ereignisspeicher; die
   Ereignisse sind vollständig, ein Wiederaufbau daraus ist nicht implementiert.
4. **Keine teamweiten Prioritätsregeln** — priorisiert wird je Datensatz, nicht
   über Personen hinweg.
5. **Kein maschinelles Lernen.** Bewusst: Was das System vorschlägt, muss sich
   in einem Satz begründen lassen.
