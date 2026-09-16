# Architektur

OKUN CRM ist eine mandantenfähige CRM-Plattform von OKUN Software. Dieses
Dokument beschreibt, wie das System aufgebaut ist, welche Garantien es gibt und
wo bewusst Grenzen gezogen wurden.

---

## 1. Überblick

```
Browser
  │  Server Components (SSR)          fetch() → REST
  ▼                                   ▼
┌─────────────────────────────────────────────────────┐
│ Next.js App Router                                  │
│  src/app/(auth)     Login, Registrierung, Einladung │
│  src/app/(app)      Arbeitsoberfläche               │
│  src/app/api/v1     REST-API                        │
├─────────────────────────────────────────────────────┤
│ API-Schicht  src/lib/api                            │
│  Auth · CSRF · Rechte · Rate Limit · Fehler · JSON  │
├─────────────────────────────────────────────────────┤
│ Domänenschicht  src/server/services, src/server/…   │
│  Validierung · Mandantenscope · Audit · Events      │
├─────────────────────────────────────────────────────┤
│ Prisma 7  →  PostgreSQL                             │
└─────────────────────────────────────────────────────┘
```

Zwei Zugriffswege auf dieselbe Domänenschicht:

- **Server Components** rufen Services direkt auf (kein HTTP-Umweg beim ersten
  Rendern).
- **Client Components** nutzen die REST-API unter `/api/v1` – dieselbe API, die
  auch externe Systeme verwenden. Die Oberfläche ist damit der erste Konsument
  der eigenen API.

## 2. Verzeichnisstruktur

| Pfad | Inhalt |
| --- | --- |
| `src/app/(auth)` | Anmeldung, Registrierung, Einladungsannahme |
| `src/app/(app)` | Authentifizierte Anwendung (Dashboard, CRM, Einstellungen) |
| `src/app/api/v1` | REST-Endpunkte |
| `src/components/ui` | Designsystem-Primitive (Button, Field, Table, Modal …) |
| `src/components/crm` | CRM-Bausteine (Listen, Detailseiten, Formulare, Timeline) |
| `src/components/brand` | Markenzeichen als Vektorkomponenten |
| `src/components/charts` | Diagramme mit validierter Farbpalette |
| `src/lib` | Framework-nahe Bausteine: Auth, Fehler, Filter, Feldregister, Format |
| `src/server/services` | Domänenlogik je Objekt |
| `src/server/workflows` | Workflow-Definition und -Engine |
| `src/server/integrations` | Integrationskatalog und Adapter-Verträge |
| `src/server/storage` | Datei-Storage-Treiber |
| `prisma` | Schema und Migrationen |
| `tests`, `e2e` | Integrationstests und End-to-End-Tests |

## 3. Mandantenfähigkeit

Die wichtigste Invariante: **Jede Zeile gehört genau einer Organisation, und
jede Abfrage ist an sie gebunden.**

- Jede Mandantentabelle hat `organizationId` mit Index.
- Services erhalten einen `ActorContext` (`src/lib/context.ts`) mit
  `organizationId`, `userId`, `role` und aufgelösten Rechten.
- Abfragen spreizen `scope(ctx)` bzw. `liveScope(ctx)` (`src/lib/tenant.ts`) in
  die `where`-Klausel. Es gibt keine Query ohne Mandantenbezug.
- Verknüpfungen werden geprüft, bevor sie geschrieben werden
  (`assertRelationsExist`, `assertOwnerInOrganization`): Ein Kontakt kann nicht
  auf ein Unternehmen einer fremden Organisation zeigen.
- `tests/tenant-isolation.test.ts` prüft diese Garantie mit zwei echten
  Organisationen über alle CRM-Einstiegspunkte hinweg.

Die aktive Organisation hängt an der Sitzung (`Session.activeOrganizationId`),
sodass eine Person später mehreren Organisationen angehören kann.

## 4. Authentifizierung und Sitzungen

- Passwörter: **scrypt** mit Zufallssalz (`src/lib/crypto.ts`), Prüfung in
  konstanter Zeit. Keine externe Krypto-Abhängigkeit.
- Sitzungen: Zufallstoken (32 Byte) im `httpOnly`-Cookie; in der Datenbank
  liegt nur der SHA-256-Hash. Laufzeit 7 Tage, gleitend verlängert.
- **CSRF**: Double-Submit. Ein lesbares `okun_csrf`-Cookie wird bei jeder
  schreibenden Anfrage als Header `x-okun-csrf` erwartet und gegen die Sitzung
  geprüft.
- Fehlversuche werden gezählt; nach acht Versuchen ist das Konto 15 Minuten
  gesperrt. Die Antwort verrät nie, ob eine E-Mail-Adresse existiert.
- Ein Passwortwechsel widerruft alle anderen Sitzungen.
- **2FA** ist im Modell (`User.twoFactorSecret`) vorbereitet, aber noch ohne
  Einrichtungsfluss.

## 5. Rollen und Rechte

Der Rechtekatalog steht in `src/lib/rbac.ts`; Rollen bündeln Rechte:

| Rolle | Kurzbeschreibung |
| --- | --- |
| `SUPER_ADMIN` | Vollzugriff inklusive Organisationsverwaltung |
| `ADMIN` | Benutzer, Einstellungen, Integrationen, alle CRM-Daten |
| `MANAGER` | CRM-Strukturen, Importe, Automatisierung, Löschen |
| `SALES` | Arbeitet mit Kontakten, Unternehmen, Leads, Deals, Aktivitäten |
| `USER` | Lesender Zugriff |

Jede Service-Funktion beginnt mit `assertPermission(ctx, …)`. Die Oberfläche
blendet aus, was der Server ohnehin ablehnt – nie umgekehrt.

## 6. Datenmodell

42 Tabellen in `prisma/schema.prisma`. Die zentralen Gruppen:

**Mandant und Identität** — `Organization`, `User`, `Membership`, `Team`,
`Invitation`, `Session`

**CRM-Objekte** — `Contact`, `Company`, `Lead`, `Deal` (+ `DealContact`,
`DealLineItem`, `DealStageHistory`), `Pipeline`, `PipelineStage`

**Interaktion** — `Activity` (die Timeline), `Task`, `Note` (+ `NoteRevision`),
`Meeting` (+ `MeetingAttendee`)

**Konfiguration** — `PropertyDefinition`, `PropertyValue`,
`LifecycleStageOption`, `LeadStatusOption`, `Tag`, `SavedView`

**Plattform** — `Workflow`, `WorkflowExecution`, `FileObject`, `EmailTemplate`,
`EmailMessage`, `IntegrationConnection`, `WebhookEndpoint`, `WebhookDelivery`,
`Notification`, `AuditLog`, `ImportJob`

### Eigene Eigenschaften (EAV, typisiert)

`PropertyValue` speichert nicht alles in einer JSON-Spalte, sondern in der
Spalte, die zum Typ passt: `valueText`, `valueNumber`, `valueBoolean`,
`valueDate`, `valueJson` (nur Mehrfachauswahl). Damit funktionieren
Bereichsfilter, Sortierung und Indizes für eigene Felder genauso wie für
Systemfelder. Die Verknüpfung erfolgt über echte Fremdschlüssel
(`contactId`, `companyId`, `leadId`, `dealId`), sodass Werte beim Löschen
mitgehen und Prisma-Relationsfilter nutzbar sind.

### Timeline

`Activity` ist der eine chronologische Strom je Datensatz: manuell erfasste
Interaktionen (Anruf, E-Mail, Meeting, Notiz) und Systemereignisse
(„Kontakt erstellt", „Stage geändert", Workflow-Aktionen). Kein getrenntes
Verlaufsmodell, keine doppelte Wahrheit.

## 7. Feldregister, Filter und Ansichten

`src/lib/crm/fields.ts` beschreibt jedes eingebaute Feld einmal: Bezeichnung,
Datentyp, sortierbar, filterbar, importierbar, Standardspalte. Daraus speisen
sich Tabellenspalten, Filterbau, Sortierung, CSV-Import-Mapping und Export.

Die Filter-Engine (`src/lib/filters.ts`) übersetzt einen Bedingungsbaum in eine
Prisma-`where`-Klausel. Operatoren sind pro Datentyp definiert, unbekannte
Felder werden abgelehnt (ein Filter darf nie versehentlich „alles" bedeuten).
Relative Datumsangaben (`-14d`, `+30d`, `today`) werden serverseitig aufgelöst.
Gespeicherte Ansichten (`SavedView`) legen Filter, Spalten und Sortierung ab.

## 8. Domänenereignisse, Workflows, Webhooks

Services lösen nach erfolgreicher Änderung ein Domänenereignis aus
(`src/lib/events.ts`). Daran hängen zwei Konsumenten:

1. **Workflow-Engine** (`src/server/workflows/engine.ts`)
   Trigger → Bedingungen → Aktionen. Bedingungen werden über dieselbe
   Filter-Engine ausgewertet, indem der Datensatz mit dem Filter erneut
   abgefragt wird. Jede Ausführung landet mit Schrittprotokoll in
   `WorkflowExecution`.
   **Schleifenschutz:** Aktionen lösen Folgeereignisse mit `depth + 1` aus; ab
   `MAX_EVENT_DEPTH` (3) wird nicht weiter ausgeführt.
2. **Webhooks** (`src/server/services/webhooks.ts`)
   Zustellung wird persistiert, dann versucht. Signatur:
   `x-okun-signature: sha256=HMAC(secret, "timestamp.body")`. Fehlschläge
   werden mit wachsendem Abstand bis zu fünfmal wiederholt.

Reaktionen lassen die auslösende Anfrage nie scheitern; Fehler werden
protokolliert.

## 9. Fehler, Validierung, API-Vertrag

- Ein Fehlertyp (`AppError`) mit festen Codes; `toErrorResponse` bildet ihn auf
  Status und JSON-Hülle `{ error: { code, message, details } }` ab.
- Zod-Fehler werden zu feldbezogenen Meldungen, die Formulare direkt anzeigen.
- Unerwartete Fehler werden serverseitig geloggt; der Client erhält eine
  neutrale Meldung ohne Stacktrace oder Treiberdetails.
- Listen liefern `{ items, page, pageSize, total, totalPages }`; die Seitengröße
  ist auf 100 begrenzt.
- Schemas (`src/lib/schemas`) werden von Client und Server geteilt.
  Semantik optionaler Felder: `undefined` = unverändert, `""` oder `null` =
  Wert löschen.

## 10. Dateien

Uploads laufen über `/api/v1/files` und landen unter einem undurchsichtigen,
mandantenpräfixierten Storage-Key. Gelesen wird ausschließlich über
`/api/v1/files/:id/content`, das Mandant und Recht prüft. **Es gibt keine
öffentliche Storage-URL.** Zulässige MIME-Typen sind allowlistet, das Limit
liegt bei 25 MB, Pfad-Traversal wird im Treiber abgefangen.

## 11. Sicherheit (Zusammenfassung)

| Thema | Umsetzung |
| --- | --- |
| Transport | CSP, `X-Content-Type-Options`, `X-Frame-Options`, Referrer-Policy, HSTS in Produktion (`next.config.ts`) |
| Sitzungen | httpOnly, SameSite=Lax, gehashte Tokens, Widerruf |
| CSRF | Double-Submit-Token bei jeder schreibenden Anfrage |
| Autorisierung | Serverseitig je Service-Aufruf |
| Mandanten | Scope in jeder Abfrage, Tests als Regressionsschutz |
| Eingaben | Zod auf dem Server, keine Businesslogik nur im Client |
| Rate Limiting | Pro Benutzer; Login zusätzlich pro Konto (kein gemeinsamer Topf) |
| Secrets | AES-256-GCM für Integrationsgeheimnisse, nie im Client |
| Logging | Passwörter, Tokens und Secrets werden redigiert |
| XSS | React-Escaping; kein `dangerouslySetInnerHTML` im Produktcode |

## 12. Performance

- Indizes auf allen Mandanten-, Owner-, Status- und Zeitfeldern, die gefiltert
  oder sortiert werden.
- Listen sind seitenweise; Zusatzdaten (offene Deals je Kontakt, eigene
  Eigenschaften) werden gruppiert nachgeladen statt pro Zeile – kein N+1.
- Aggregate (Pipeline-Wert, Reports) laufen als `groupBy`/`aggregate` in der
  Datenbank, nicht in der Anwendung.
- Die globale Suche fragt je Objekt mit kleinem Limit und nur mit vorhandener
  Leseberechtigung.

## 13. Bekannte Grenzen

Bewusst offen gelassen und nicht als fertig dargestellt:

1. **Kein Hintergrund-Queue.** CSV-Import (max. 5.000 Zeilen), Workflows und
   Webhook-Erstzustellung laufen inline im Request. Für größere Volumina und
   zuverlässige Wiederholungen gehört ein Worker davor.
2. **Rate Limiting im Prozessspeicher.** Für mehrere Instanzen braucht es einen
   gemeinsamen Speicher (z. B. Redis).
3. **Webhook-Wiederholungen** brauchen einen Scheduler, der
   `retryPendingWebhookDeliveries()` regelmäßig aufruft.
4. **Kein E-Mail-Transport implementiert.** Der Adapter-Vertrag steht, die
   Oberfläche kennzeichnet den Zustand.
5. **2FA** ohne Selbsteinrichtung.
6. **Endgültiges Löschen** existiert im Service (`purgeContact`), aber bewusst
   noch ohne Oberfläche.
7. **Mehrere Organisationen je Person** sind modelliert, ein Umschalter in der
   Oberfläche fehlt noch.
8. **Volltextsuche** nutzt `ILIKE`; ab großen Datenmengen ist ein
   Postgres-Volltextindex (`tsvector`) oder eine Suchmaschine sinnvoll.

## 14. Erweiterungsmöglichkeiten

- E-Mail-Adapter (SMTP, Google, Microsoft) gegen `EmailTransport` implementieren
  und im Katalog freischalten.
- Dashboard-Widgets konfigurierbar machen (Datenmodell dafür ist vorhanden:
  `SavedView` als Vorbild, `brandConfig` für organisationsweite Einstellungen).
- Weitere Objekte (Angebote, Verträge, Produkte) nach demselben Muster:
  Prisma-Modell → Service → Feldregister → API → Liste/Detail.
- Kalendersynchronisation über die vorbereitete Integrationsschicht.
