# Customer Acquisition Engine

Die Erweiterung, die OKUN CRM einen Schritt vor den Lead stellt: Zielgruppe →
Prospect → Ansprache → Antwort → Opportunity → Kunde, ohne Systembruch.

Dieses Dokument hält fest, **was wiederverwendet wird**, **was wirklich neu
ist** und **warum** — damit die Engine kein zweites CRM neben dem CRM wird.

---

## 1. Was bereits da ist und weiterverwendet wird

Die Analyse der Codebasis vor dem ersten Commit. Alles hier Genannte wird
benutzt, nicht nachgebaut.

| Vorhanden | Verwendung in der Acquisition Engine |
| --- | --- |
| `organizationId` auf jeder Zeile, `scope(ctx)` | Mandantentrennung unverändert — kein eigener Mechanismus |
| `PERMISSIONS` + `assertPermission` | neue Rechte reihen sich in den bestehenden Katalog ein |
| `emitDomainEvent` (`src/lib/events.ts`) | dieselbe Fan-out-Stelle: Workflows, Webhooks, aktives CRM |
| `ScheduledAutomation` + `runSweepForOrganization` | Sequenzschritte werden hierüber terminiert und ausgeführt |
| `systemContextFor` | Hintergrundläufe handeln als echtes Mitglied, nicht anonym |
| `EmailTemplate`, Vorlagenvorschau | Sequenz-E-Mails und Variablen |
| `EmailMessage` | gesendete und eingegangene Nachrichten — **erweitert**, nicht dupliziert |
| `IntegrationConnection` + SMTP-Transport | Versandkonten |
| `Activity` und die Detailseiten-Chronik | Outreach erscheint in der CRM-Timeline |
| `Task` | manuelle Sequenzschritte (Anruf, persönliche Mail) |
| `Contact`, `Company`, `Deal` | Ziel der Konvertierung |
| `record-list.tsx`, `filterGroupSchema`, `SavedView` | Prospect-Liste, dynamische Listen, gespeicherte Ansichten |
| `AuditLog` | Auditierbarkeit relevanter Aktionen |
| `NextAction` und die Regel-Engine | Next Best Action auch für Prospects |
| Import-Dienst (`imports.ts`) | CSV als Prospect-Quelle |
| Dublettendienst (`duplicates.ts`) | Dublettenvermeidung bei der Konvertierung |

**Bewusst nicht neu gebaut:** Job-Queue, Event-Bus, Berechtigungsmodell,
Mandantentrennung, Mailversand, Timeline, Audit. Eine parallele Infrastruktur
daneben wäre der schnellste Weg zu zwei Systemen, die auseinanderlaufen.

## 2. Was wirklich neu ist — und warum

Ein neues Objekt nur dort, wo Prospecting eine eigene Semantik hat.

| Neu | Warum kein vorhandenes Objekt genügt |
| --- | --- |
| `Prospect` | Ein Prospect ist **noch kein Kontakt**. Er ist ungeprüft, oft ohne Einwilligung, häufig ohne Ansprechpartner, und er soll den echten Bestand nicht verwässern. Ein Lead ist bereits eine eingegangene Anfrage — ein Prospect ist eine *ausgehende* Vermutung. |
| `ProspectList` | Arbeitsvorrat für Recherche und Kampagnen. Statisch (feste Mitgliedschaft) oder dynamisch (Filter). |
| `Sequence` / `SequenceStep` | Ein mehrstufiger Ablauf über Tage mit Bedingungen — das leistet weder ein Workflow (ereignisgetrieben, einstufig) noch eine Aufgabe. |
| `SequenceEnrollment` / `EnrollmentStepRun` | Der Zustand *eines* Prospects *in einer* Sequenz. Hier hängt alles, was Idempotenz und Stoppen betrifft. |
| `SendingAccount` | Ein Postfach mit Tageslimit, Sendefenster, Zustand. Eine `IntegrationConnection` beschreibt die Verbindung, nicht die Versandregeln. |
| `SuppressionEntry` | Kontaktsperre über Prospects, Kontakte und Kampagnen hinweg — muss unabhängig vom einzelnen Datensatz überleben. |
| `ProvenanceRecord` | Herkunft je Feld. Ohne sie lässt sich „woher stammt diese Telefonnummer?" nicht beantworten. |

`EmailMessage` wird um `prospectId`, `enrollmentId`, `stepRunId`,
`replyClassification` und Zustellmerkmale **erweitert**. Eine zweite
Nachrichtentabelle daneben hätte zwei Wahrheiten über dieselbe E-Mail erzeugt.

## 3. Schichten

```
UI (Outreach-Bereich, bestehendes Designsystem)
        │
Dienste (src/server/services/acquisition/*)
        │
Provider-Abstraktion ──► ProspectingProvider
                    ├──► EnrichmentProvider
                    ├──► SendingProvider
                    └──► IntelligenceProvider
        │
Datenmodell (Prisma) ── die einzige Wahrheit
        │
Ereignisse (emitDomainEvent) ──► Workflows · Webhooks · aktives CRM · Analytics
        │
Hintergrund (ScheduledAutomation + Sweep)
```

### Provider-Abstraktion

Externe Quellen gehören nie in die Geschäftslogik. Jeder Provider ist eine
Implementierung einer schmalen Schnittstelle und in einer Registry eingetragen.

**Ausgeliefert werden nur Provider, die wirklich etwas tun:**

| Provider | Art | Status |
| --- | --- | --- |
| `manual` | Prospecting | umgesetzt — Eingabe von Hand |
| `csv` | Prospecting | umgesetzt — Tabellenimport über den vorhandenen Importdienst |
| `crm` | Prospecting | umgesetzt — vorhandene Unternehmen ohne Deal als Prospects |
| `smtp` | Sending | umgesetzt — vorhandener SMTP-Transport |

Externe Datenanbieter, Enrichment-APIs und eine Intelligence-Schicht haben eine
**Schnittstelle, aber keine Implementierung**. Sie erscheinen nicht als
verfügbare Funktion, solange sie nichts liefern. Was nicht angebunden ist, wird
nicht als fertig dargestellt.

**Ausdrücklich nicht gebaut:** keine Architektur, deren Voraussetzung das
Auslesen von Google Maps oder vergleichbaren Plattformen entgegen deren
Bedingungen ist. Die Engine ist technisch von keinem einzelnen Anbieter
abhängig.

## 4. Lebenszyklus eines Prospects

```
NEW → RESEARCHING → QUALIFIED → READY → IN_SEQUENCE → REPLIED
                                                        ├─► INTERESTED → MEETING → CONVERTED
                                                        ├─► NOT_INTERESTED
                                                        └─► DISQUALIFIED
                                              jederzeit ─► DO_NOT_CONTACT
```

Die Übergänge sind geprüft: `CONVERTED` erreicht man nur über die
Konvertierung, `DO_NOT_CONTACT` von überall. Ein Prospect in `DO_NOT_CONTACT`
kann nicht eingeschrieben werden — das wird serverseitig durchgesetzt, nicht in
der Oberfläche versteckt.

## 5. Ereignisse

Neue Namen im bestehenden `DOMAIN_EVENTS`-Katalog, damit sie ohne Zusatzarbeit
Workflows, Webhooks und die Chronik erreichen:

```
prospect.created · prospect.qualified · prospect.enrolled
prospect.replied · prospect.interested · prospect.unsubscribed
prospect.converted · prospect.suppressed
sequence.started · sequence.stopped
outreach.email_scheduled · outreach.email_sent · outreach.email_bounced
outreach.reply_received · outreach.reply_classified
```

## 6. Konvertierung ins CRM

Der wichtigste Punkt der ganzen Erweiterung. Aus einem Prospect entsteht:

1. ein **Unternehmen** — oder das vorhandene wird erkannt (Domain als Merkmal),
2. ein **Kontakt** — oder der vorhandene wird erkannt (E-Mail als Merkmal),
3. optional ein **Deal**,
4. die vollständige **Historie**: Quelle, Liste, Sequenz, jede gesendete
   Nachricht, jede Antwort, Notizen, Aufgaben, Owner.

Die Nachrichten werden **umgehängt, nicht kopiert**: dieselbe `EmailMessage`
trägt danach zusätzlich `contactId` und `companyId`. Damit gibt es keine
doppelte Chronik und keine zweite Wahrheit.

Der Prospect bleibt als Ursprungsdatensatz bestehen und zeigt auf den
entstandenen Kontakt — das ist die Grundlage der Attribution.

## 7. Compliance als Funktion, nicht als Zusicherung

Die Software stellt Werkzeuge bereit. Sie behauptet **nicht**, dass eine
bestimmte Nutzung rechtlich zulässig ist — das hängt von Verträgen, Prozessen
und dem Einzelfall ab und lässt sich technisch nicht herstellen.

Bereitgestellt werden: dokumentierte Datenquelle je Feld, Kontaktstatus,
ein konfigurierbarer Prüfstatus für den Rechtsgrund, Kontaktsperre,
Abmeldung, Sperrlisten, vollständige Outreach-Historie, Auditierbarkeit,
Löschung.

## 8. Verantwortungsvoller Versand

Kein Werkzeug für Massenversand. Vorgesehen sind Tageslimits je Postfach,
Sendefenster mit Zeitzone, variable Abstände, Bounce-Behandlung, Sperrlisten
und automatische Pausierung bei Auffälligkeiten. Menge ist kein Ziel.

## 9. Oberfläche

Sieben Seiten unter `/outreach`, alle im bestehenden Designsystem — dieselben
Karten, Tabellen, Formulare, Schubladen und Leerzustände wie im übrigen CRM.
Keine zweite Designwelt.

| Seite | Was sie beantwortet |
| --- | --- |
| Überblick | Was ist aus der Ansprache geworden — und was liegt liegen? |
| Prospects | Wer kommt in Frage, und woher wissen wir das? |
| Listen | Welcher Arbeitsvorrat gehört zusammen? |
| Sequenzen | Wie sprechen wir an, und wann hält das an? |
| Antworten | Worauf muss jemand reagieren? |
| Versand | Unter welchen Grenzen wird gesendet, und wer ist gesperrt? |

Nicht neu gebaut: **Vorlagen** und **Aufgaben**. Die Sequenz greift auf die
vorhandenen Vorlagen zu, und ein Aufgabenschritt erzeugt eine gewöhnliche
CRM-Aufgabe — sie erscheint dort, wo der Vertrieb ohnehin hinsieht.

### Wo die Oberfläche bewusst bremst

- Eine neue Sequenz ist **Entwurf** und sendet nichts. Aktiviert wird bewusst.
- Eine Sequenz mit automatischen E-Mails lässt sich **ohne Versandkonto nicht
  aktivieren** — sonst liefe sie sichtbar und täte nichts.
- Der Import zeigt **Angelegt, Dubletten, Gesperrt, Übersprungen** getrennt.
  Eine reine Erfolgsmeldung verschweigt genau das, was man wissen will.
- Die Übernahme ins CRM zeigt **vorher**, was sie tun wird: welches Unternehmen
  erkannt wurde, ob ein Kontakt entsteht, wie viele Nachrichten mitkommen.
- Ein gesperrter Prospect zeigt die Sperre und den Grund; die Schaltfläche für
  die Sequenz erscheint gar nicht erst.

## 10. Umsetzungsstand

Die Engine entsteht in abgeschlossenen Schritten. Dieser Abschnitt sagt
jederzeit, was davon wirklich läuft.

| Schritt | Umfang | Stand |
| --- | --- | --- |
| 1 | Datenmodell, Rechte, Ereignisse, Provider-Abstraktion, Prospects, Listen, Sperrlisten, Konvertierung | **fertig** — 29 Tests |
| 2 | Sequenzen, Einschreibungen, Versand, Antwortverarbeitung | **fertig** — 35 Tests |
| 3 | Oberfläche des Outreach-Bereichs | **fertig** — 7 E2E-Tests |
| 4 | Trichter, Herkunftsauswertung und offene Punkte | **fertig** (im Überblick) · Acquisition-Kennzahlen im Haupt-Dashboard offen |
