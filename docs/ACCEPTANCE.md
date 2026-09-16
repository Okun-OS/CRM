# Abnahmeprotokoll

Stand: 16.09.2026 · Commit: siehe `git log`

Enthält die Abnahme des CRM-Kerns (Punkte 1–35) und die des aktiven CRM
(Punkte A1–A15).

Jeder Punkt der vereinbarten End-to-End-Abnahme ist unten klassifiziert:

- **VERIFIZIERT** – automatisiert getestet und/oder in der laufenden Anwendung
  ausgeführt; der Nachweis steht daneben.
- **TEILWEISE** – Kern funktioniert und ist getestet, ein benannter Teil nicht.
- **OFFEN** – bewusst nicht umgesetzt, mit Begründung.

Nichts ist als verifiziert markiert, das nicht tatsächlich ausgeführt wurde.

## Testbasis

| Suite | Umfang | Lauf |
| --- | --- | --- |
| `pnpm test` | 126 Unit- und Integrationstests gegen eine echte PostgreSQL-Datenbank | grün |
| `pnpm test:e2e` | 22 Playwright-Tests gegen den gebauten Server (inkl. Smoke-Test über alle 34 Seiten) | grün |
| `pnpm build` | Produktionsbuild inkl. Typprüfung | grün |

## Abnahmepunkte

| # | Punkt | Status | Nachweis |
| --- | --- | --- | --- |
| 1 | Neue Organization | VERIFIZIERT | E2E „1 · Organisation registrieren"; Test „registriert eine Organisation mit Standardkonfiguration" (Pipeline, Stages, Lead-Status werden provisioniert) |
| 2 | Admin Login | VERIFIZIERT | E2E 1 und 10 |
| 3 | Teammitglied anlegen | VERIFIZIERT | Test „führt den Einladungsfluss bis zur aktiven Mitgliedschaft" (Einladung → Annahme → aktive Mitgliedschaft, Token einmalig); Oberfläche unter Einstellungen → Benutzer |
| 4 | Rolle vergeben | VERIFIZIERT | Tests zu `assignableRoles`, `updateMember`, Schutz des letzten Super-Administrators |
| 5 | Kontakt erstellen | VERIFIZIERT | E2E 2 |
| 6 | Unternehmen erstellen | VERIFIZIERT | E2E 2 |
| 7 | Kontakt Unternehmen zuordnen | VERIFIZIERT | E2E 2 (Auswahl im Formular, Verknüpfung auf der Detailseite) |
| 8 | Lead erstellen | VERIFIZIERT | E2E-Smoke legt einen Lead über die Oberfläche an; Integrationstests zu Pflichtangaben und Statusprüfung |
| 9 | Aktivität protokollieren | VERIFIZIERT | E2E „3b · Anruf protokollieren"; Test zu `lastActivityAt`/`nextActivityAt` |
| 10 | Aufgabe erstellen | VERIFIZIERT | E2E 3; Tests zu Lebenszyklus und Ansichten (heute/überfällig) |
| 11 | Deal erstellen | VERIFIZIERT | E2E 4 |
| 12 | Deal Pipeline zuordnen | VERIFIZIERT | E2E 4; Test „wechselt die Stage nur innerhalb derselben Pipeline" |
| 13 | Stage ändern | VERIFIZIERT | E2E 4 und 5; Tests zu Stage-Historie, Gewonnen/Verloren und Wahrscheinlichkeit |
| 14 | Dealwert ändern | VERIFIZIERT | Test „aktualisiert Dealwerte und protokolliert sie" (Timeline-Eintrag mit Vorher/Nachher) |
| 15 | Notiz erstellen | VERIFIZIERT | E2E 3; Test zur Revisionshistorie beim Bearbeiten |
| 16 | Meeting erstellen | VERIFIZIERT | E2E 3b (Termin angelegt, im Kalender sichtbar) |
| 17 | Custom Property erstellen | VERIFIZIERT | E2E 6; Tests zu Typen, Optionen und Pflichtfeldern |
| 18 | Property setzen | VERIFIZIERT | E2E 6 (Wert am Kontakt gesetzt und auf der Detailseite sichtbar) |
| 19 | Kontakte filtern | VERIFIZIERT | E2E 7; Tests zur Filter-Engine inkl. eigener Eigenschaften und relativer Daten |
| 20 | View speichern | VERIFIZIERT | E2E 7 (Ansicht gespeichert und nach Reload vorhanden) |
| 21 | Globale Suche | VERIFIZIERT | E2E 8; Test, dass fremde Organisationen nicht gefunden werden |
| 22 | CSV-Import | VERIFIZIERT | E2E 11 (Upload → Zuordnungsvorschlag → Import → Bericht); Tests zu Trennzeichen, Anführungszeichen, Duplikatstrategien und fehlerhaften Zeilen |
| 23 | Duplicate Detection | VERIFIZIERT | Tests zu Erkennung (E-Mail, Domain) und Zusammenführen ohne Datenverlust |
| 24 | Workflow erstellen | VERIFIZIERT | Tests zu Anlage und Validierung der Aktionsziele; Oberfläche im Smoke-Test |
| 25 | Workflow auslösen | VERIFIZIERT | Tests: Ausführung, Bedingungsprüfung, stage-spezifischer Trigger, Schleifenschutz, Fehlerfall |
| 26 | Notification prüfen | VERIFIZIERT | Tests zu Zuweisungsbenachrichtigungen (Aufgabe, Deal) und Lesestatus |
| 27 | Audit Log prüfen | VERIFIZIERT | E2E 9; Tests zu Anlage-, Änderungs- und Differenzeinträgen |
| 28 | Berechtigungen mit anderem Benutzer | VERIFIZIERT | `tests/permissions.test.ts` mit zweitem Mitglied je Rolle |
| 29 | Tenant Isolation | VERIFIZIERT | `tests/tenant-isolation.test.ts`: 9 Tests über alle CRM-Einstiegspunkte |
| 30 | Logout/Login | VERIFIZIERT | E2E 10 inkl. Umleitung geschützter Seiten |
| 31 | Mobile/Tablet | VERIFIZIERT | E2E 13: 390 px (Liste, Aufgaben, Navigationsmenü) und 820 px (Detailseite, Pipeline) |
| 32 | Fehlerzustände | VERIFIZIERT | E2E 12 (falsche Anmeldung, Feldvalidierung); Tests zu Fehlerhülle, Validierungsdetails und neutraler 500-Meldung |
| 33 | Branding | VERIFIZIERT | E2E 1 prüft das Endorsement in der Navigation; visuelle Prüfung von Login, Dashboard, Listen, Detail, Pipeline, Reports |
| 34 | OKUN CRM Logo | VERIFIZIERT (mit Hinweis) | Produktzeichen in Navigation, Login und Favicon. **Hinweis:** Die Vektorzeichen sind aus der Markenreferenz rekonstruiert; die finalen Dateien aus dem Markenpaket ersetzen sie in `public/brand/` (siehe docs/BRANDING.md) |
| 35 | „Powered by OKUN Software" | VERIFIZIERT | E2E 1; sichtbar in Login, Sidebar-Footer und Einstellungen |

## Abnahme des aktiven CRM

Die Ergänzung zum Master-Prompt gibt eine Reihenfolge vor: zuerst die
technische Grundlage, dann die Automationen. Genau so wurde gebaut; Punkte
jenseits dieser Reihenfolge sind nicht vorweggenommen.

| # | Punkt | Status | Nachweis |
| --- | --- | --- | --- |
| A1 | Ereignismodell | VERIFIZIERT | `DomainEventRecord`; Test „verarbeitet dieselbe Lieferung nur einmal" (zweite Zustellung wird als Duplikat erkannt, keine zweite Aktivität, kein zweiter Feldeffekt) |
| A2 | Operativer Deal-Zustand | VERIFIZIERT | Test „wechselt bei eingehender Antwort auf ‚Wir sind am Zug'"; E2E 3 und 4 zeigen den Wechsel in der Oberfläche |
| A3 | Nächste Aktion je Deal und Lead | VERIFIZIERT | Test „gibt jedem neuen Deal sofort einen nachvollziehbaren nächsten Schritt"; E2E 2 |
| A4 | Warte-Zustand (uns / Kunde / keiner) | VERIFIZIERT | Tests zum Regelkatalog und „entscheidet bei identischem Zeitstempel anhand der Ereignisreihenfolge" |
| A5 | Action Center „Heute" | VERIFIZIERT | Test „sortiert offene Aktionen in die Buckets des Vertriebstags"; E2E 6 |
| A6 | Stagnationserkennung | VERIFIZIERT | Test „erkennt Stagnation und meldet sie dem Verantwortlichen" (Momentum `STAGNIERT`, `stalledSince`, Empfehlung `REACTIVATE`, Benachrichtigung) |
| A7 | Regel-Engine, konfigurierbar | VERIFIZIERT | Tests zu Reihenfolge, Deaktivierung und Verzug-Override; Oberfläche unter Einstellungen → Aktives CRM |
| A8 | Automatische Aktivitätserfassung | VERIFIZIERT | Test „schreibt die Timeline automatisch, ohne dass jemand etwas erfasst" |
| A9 | Aufgaben automatisch erzeugen und schließen | VERIFIZIERT | Tests „erstellt bei Fälligkeit eine Aufgabe für den Verantwortlichen" und zum automatischen Schließen bei Kundenantwort; von Hand angelegte Aufgaben bleiben unberührt |
| A10 | Sichere Follow-up-Automation | VERIFIZIERT | Test „prüft die Sicherheitsbedingungen erneut, unmittelbar vor der Ausführung" (Kunde antwortet nach dem Planen → übersprungen mit Grund, keine Aufgabe) |
| A11 | Anbindung OKUN Deals | VERIFIZIERT | Tests zur Zuordnung über die Kontakt-E-Mail, zur Meldung unauflösbarer Ereignisse und zur Mandantenbindung des API-Keys; E2E 7 |
| A12 | Weitere Integrationen | OFFEN | Bewusst nicht vorweggenommen; die Ingestion-Schnittstelle steht dafür bereit |
| A13 | Manuelle Übersteuerung nachvollziehbar | VERIFIZIERT | Tests zu Erledigen, Verschieben, Verwerfen (nur mit Begründung), Wiedervorlage und Pausieren – jeweils mit Timeline- und Audit-Eintrag; E2E 5 |
| A14 | Momentum ohne erfundene Kennzahlen | VERIFIZIERT | Tests „begründet jeden Wert mit sichtbaren Signalen" und zur Stagnation; die Oberfläche zeigt alle Signale mit Gewicht und nennt ausdrücklich, dass es keine Abschlusswahrscheinlichkeit ist |
| A15 | Mandantentrennung der neuen Ebene | VERIFIZIERT | Test „zeigt keine Aktionen, Ereignisse oder Automationen fremder Organisationen" |

## Offene Punkte

Diese Punkte sind bewusst nicht umgesetzt und werden nirgends als fertig
dargestellt:

| Thema | Zustand | Auswirkung in der Oberfläche |
| --- | --- | --- |
| E-Mail-Versand | Adapter-Vertrag steht, kein Transport implementiert | Versand meldet „kein Postausgang verbunden", die Nachricht wird als Entwurf gespeichert |
| Google / Microsoft / Slack / Stripe / Calendly | Katalog und Verbindungsmodell vorhanden, Adapter offen | Im Integrationskatalog als „Adapter noch nicht implementiert" mit Voraussetzungen gekennzeichnet |
| Zwei-Faktor-Authentifizierung | Datenmodell und Sitzungsprüfung vorbereitet | Profilseite nennt den Stand ausdrücklich |
| Hintergrund-Queue | Import, Workflows und Webhook-Erstzustellung laufen inline | Import auf 5.000 Zeilen begrenzt und im Assistenten benannt |
| Webhook-Wiederholungen | Benötigen einen Scheduler | Einstellungen → System zeigt wartende Zustellungen |
| Endgültiges Löschen | Im Service vorhanden, ohne Oberfläche | Datenschutzseite erklärt Soft Delete und den offenen Teil |
| Organisationswechsel | Datenmodell unterstützt mehrere Mitgliedschaften | Kein Umschalter in der Oberfläche |
| Dashboard-Builder | Feste, sinnvolle Dashboard-Komposition | Keine Widget-Konfiguration |
| Volltextsuche | `ILIKE`-basiert | Ausreichend für den aktuellen Umfang, für große Bestände ist ein Volltextindex vorgesehen |
| Zeitgesteuerter Durchlauf | `POST /api/v1/scheduler/run` ist implementiert und getestet, braucht aber einen externen Auslöser | Ohne Scheduler reagiert das System auf Ereignisse, nicht auf reinen Zeitablauf; Betriebshandbuch nennt Takt und Aufruf |
| Automatische Kunden-E-Mails | Nur mit ausdrücklich eingerichteter Vorlage und verbundenem Transport; ein Transport existiert derzeit nicht | Automatisiert werden interne Erinnerungen; eine E-Mail-Automation ohne Transport wird mit Grund übersprungen |
| Ereignis-Wiederholung (Replay) | Der Ereignisspeicher ist vollständig, ein Wiederaufbau daraus ist nicht implementiert | Keine Oberfläche, keine Andeutung |

## Nicht beanspruchte Aussagen

- **Keine Aussage zur DSGVO-Konformität.** Das Produkt bietet Mandantentrennung,
  Rechteprüfung, Audit Log, Soft Delete und Exporte. Ob ein Einsatz konform ist,
  hängt von Betrieb, Verträgen und Prozessen des einsetzenden Unternehmens ab.
- **Keine KI-Funktionen.** Es sind keine implementiert und keine angedeutet.
  Das Momentum ist eine Summe benannter, angezeigter Signale, keine Schätzung.
  Abschlusswahrscheinlichkeiten stammen weiterhin aus Stage oder Eingabe, nicht
  aus einem Modell.
- **Keine Demo-Daten im Produktbetrieb.** Der Seed ist ein separates Skript für
  lokale Entwicklung.

## Während der Abnahme gefundene und behobene Fehler

Die Testsuiten haben sechs echte Fehler aufgedeckt, die vor der Abgabe behoben
wurden:

1. `deal.stage_changed` trug nur Stage-Namen – stage-spezifische Workflow-Trigger
   lösten nie aus.
2. Detailseiten reichten eine Render-Funktion über die Server/Client-Grenze –
   jede Datensatzseite stürzte ab.
3. Optionale Felder ließen sich nicht leeren: `null` wurde von den Schemas
   abgelehnt, ein Bearbeiten-Formular konnte nur hinzufügen.
4. Unangemeldete Anfragen teilten sich einen Rate-Limit-Topf – ein Angreifer
   hätte die Anmeldung für alle sperren können. Jetzt zählen nur Fehlversuche,
   und zwar je Konto.
5. Die Timeline eines Datensatzes aktualisierte sich nach einer Stage-Änderung
   nicht.
6. Zwei im selben Minutentakt erfasste Aktivitäten trugen denselben Zeitstempel;
   damit ließ sich nicht mehr bestimmen, wer am Zug ist, und ein Deal blieb nach
   einer Kundenantwort auf „Warten auf Kunden" stehen. Der Zustand wird jetzt
   zusätzlich über die Reihenfolge der aufgezeichneten Ereignisse entschieden.
   Gefunden durch den End-to-End-Test „Eine eingehende Antwort dreht den
   Zustand".
