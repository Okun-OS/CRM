# Datenmodell

Vollständige Definition: `prisma/schema.prisma`. Dieses Dokument erklärt die
Beziehungen und die Entscheidungen dahinter.

---

## Mandant und Identität

```
Organization ──< Membership >── User
      │              │
      │              └── Team (hierarchisch über parentTeamId)
      ├──< Invitation
      └──< Session (activeOrganizationId)
```

- Eine Person (`User`) kann mehreren Organisationen angehören; die Rolle hängt
  an der `Membership`, nicht am Benutzer.
- `Session` hält die aktive Organisation, damit ein späterer Wechsel ohne
  erneute Anmeldung möglich ist.
- `Invitation` speichert nur den Hash des Einladungstokens.

## CRM-Objekte

```
Company ──< Contact ──< DealContact >── Deal >── Pipeline ──< PipelineStage
   │          │                          │  │
   │          └──< Lead                  │  └──< DealLineItem
   │                                     └──< DealStageHistory
   └──────────────< Deal
```

- **Contact** ist die Person, **Company** der Kontext, **Lead** die noch nicht
  qualifizierte Chance mit eigenem Status-Prozess, **Deal** die Verkaufschance.
- **Lead** ist bewusst ein eigenes Objekt und kein Kontakt mit Etikett: eigene
  Qualifizierungsfelder (Quelle, Bewertung, nächster Schritt) und ein
  Konvertierungspfad, der `convertedContactId`, `convertedCompanyId` und
  `convertedDealId` festhält.
- **Deal ↔ Contact** ist n:m (`DealContact`, mit `isPrimary`), weil an einem
  Abschluss mehrere Personen beteiligt sind.
- **DealStageHistory** hält jeden Stage-Wechsel samt Verweildauer fest – das ist
  die Grundlage für die Auswertung der Durchlaufzeiten.

## Interaktion

```
Activity ──> Contact | Company | Deal | Lead        (mehrfach verknüpfbar)
   │
   ├──> Task | Meeting | Note | EmailMessage        (Herkunft des Eintrags)
   └──> User (actorId)
```

`Activity` ist der eine chronologische Strom. Manuelle Einträge (Anruf, E-Mail,
Meeting, Notiz) und Systemereignisse (Datensatz erstellt, Stage geändert,
Workflow-Aktion) liegen in derselben Tabelle, damit die Timeline vollständig
ist und nicht aus mehreren Quellen zusammengesetzt werden muss.

`Task`, `Note`, `Meeting` und `FileObject` tragen dieselben optionalen
Fremdschlüssel (`contactId`, `companyId`, `dealId`, `leadId`). Das erlaubt
Verknüpfungen zu mehreren Objekten, hält referenzielle Integrität und macht
Kaskadenlöschungen möglich – im Gegensatz zu einer polymorphen ID-Spalte.

`Note` führt über `NoteRevision` eine Bearbeitungshistorie: Notizen werden nicht
still überschrieben.

## Eigene Eigenschaften

```
PropertyDefinition (organizationId, objectType, key, type, options)
        │
        └──< PropertyValue (contactId | companyId | leadId | dealId)
                valueText · valueNumber · valueBoolean · valueDate · valueJson
```

Typisierte Spalten statt einer JSON-Spalte, damit Filter, Sortierung und
Indizes für eigene Felder genauso funktionieren wie für Systemfelder. Je
Definition und Datensatz ist genau ein Wert erlaubt (Unique-Constraints je
Objektspalte).

## Konfiguration

`LifecycleStageOption`, `LeadStatusOption`, `Pipeline`/`PipelineStage` und `Tag`
sind pro Organisation administrierbar. Beim Anlegen einer Organisation werden
sinnvolle Vorgaben provisioniert. Systemwerte sind markiert (`isSystem`) und
gegen Löschen geschützt; Werte, die noch verwendet werden, lassen sich nicht
entfernen.

## Plattform

| Modell | Zweck |
| --- | --- |
| `SavedView` | Filter, Spalten und Sortierung je Objekt, privat oder geteilt |
| `Workflow`, `WorkflowExecution` | Automatisierung mit Schrittprotokoll |
| `EmailTemplate`, `EmailMessage` | Vorlagen und geführte Kommunikation |
| `IntegrationConnection` | Verbindungsstatus, Konfiguration, verschlüsseltes Secret |
| `WebhookEndpoint`, `WebhookDelivery` | Ausgehende Ereignisse mit Zustellprotokoll |
| `FileObject` | Dateimetadaten, Storage-Key, Verknüpfung |
| `Notification` | In-App-Benachrichtigungen mit Lesestatus |
| `AuditLog` | Wer hat was wann geändert (append-only) |
| `ImportJob` | Importlauf mit Mapping, Zahlen und Fehlerliste |

## Löschen

CRM-Objekte werden weich gelöscht (`deletedAt`): Sie verschwinden aus Listen und
Suche, bleiben aber wiederherstellbar und im Audit Log nachvollziehbar. Der
Service-Layer bietet zusätzlich eine endgültige Löschung (`purgeContact`), die
`settings.manage` verlangt.

## Indizes

Jede Mandantentabelle ist auf `organizationId` indiziert, kombiniert mit den
Feldern, nach denen tatsächlich gefiltert und sortiert wird (`deletedAt`,
`ownerId`, `createdAt`, `lastActivityAt`, Status- und Stage-Felder). Die
Timeline ist zusätzlich je verknüpftem Objekt nach `occurredAt` indiziert.

## Aktives CRM

```
Deal ──< DomainEventRecord >── Organization
  │  ├──< NextAction >── Task
  │  └──< ScheduledAutomation >── EmailTemplate
Lead ── (dieselben drei Beziehungen)

Organization ──< ApiKey
             ├── ActiveCrmSetting (1:1)
             └──< ActiveCrmRuleSetting
```

- **DomainEventRecord** ist append-only und die Quelle jeder Erklärung. Der
  eindeutige Schlüssel `[organizationId, idempotencyKey]` macht Lieferungen
  anderer Systeme wiederholbar, ohne doppelt zu wirken.
- **NextAction** trägt `reason` als Pflichtfeld: Ein Vorschlag ohne Begründung
  ist im Modell nicht darstellbar. `ruleKey` benennt die Regel, `isManual`
  unterscheidet die Entscheidung eines Menschen von der des Systems. Erledigte
  und verworfene Aktionen bleiben als Verlauf stehen (`SUPERSEDED`, `DONE`,
  `DISMISSED`), statt gelöscht zu werden.
- **ScheduledAutomation** führt ihre Bedingungen in `guards` mit und hält in
  `outcomeReason` fest, warum sie ausgeführt, übersprungen oder abgebrochen
  wurde.
- **Deal** und **Lead** tragen den operativen Zustand denormalisiert
  (`operationalState`, `nextActionAt`, `nextActionType`, `nextActionTitle`,
  `momentum`, `momentumSignals`) — damit Listen und Board ohne Nachladen
  auskommen. Die Wahrheit bleibt die `NextAction`; der Abgleich hält beides
  deckungsgleich.
- **ApiKey** speichert nur den SHA-256-Hash. Der Klartext wird genau einmal
  angezeigt und ist danach nicht wiederherstellbar.
- **PipelineStage** kann mit `expectedAction` und `expectedActionDays`
  festlegen, worauf ein Deal in dieser Stage wartet — die konfigurierbare
  Stelle des Regelkatalogs.
