# OKUN CRM

**Kunden. Beziehungen. Wachstum.**
Ein Produkt von **OKUN Software**.

OKUN CRM verbindet Menschen, Prozesse und Chancen in einer Plattform: Kontakte,
Unternehmen, Leads, Deals, Aktivitäten, Aufgaben, Termine, E-Mail-Vorlagen,
Automatisierung, Auswertungen und Administration – mandantenfähig und mit
serverseitig durchgesetzten Berechtigungen.

Der Unterschied liegt in der Arbeitsweise: **OKUN CRM wartet nicht auf Pflege,
sondern übernimmt Arbeit.** Jeder offene Deal und Lead trägt einen nächsten
Schritt mit Fälligkeit, Verantwortlichem und Begründung; die Timeline schreibt
sich aus dem, was tatsächlich passiert; ein Follow-up wird gestoppt, sobald der
Kunde antwortet. Was das System vorschlägt, lässt sich immer in einem Satz
begründen – es gibt keine erfundene Abschlusswahrscheinlichkeit und keinen
Lead-Score (siehe [docs/ACTIVE-CRM.md](docs/ACTIVE-CRM.md)).

---

## Schnellstart

```bash
pnpm install

cp .env.example .env            # DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY setzen
openssl rand -base64 32         # Werte für SESSION_SECRET und ENCRYPTION_KEY

pnpm db:migrate                 # Schema anlegen
pnpm dev                        # http://localhost:3000
```

Beim ersten Aufruf führt `/register` durch die Einrichtung: Organisation anlegen,
Administrator erstellen. Pipeline, Lifecycle Stages und Lead-Status werden dabei
automatisch mit sinnvollen Vorgaben provisioniert – **ohne Demo-Datensätze**.

Für lokale Entwicklung mit Beispieldaten (klar als solche gekennzeichnet):

```bash
pnpm seed:demo                  # legt „OKUN Demo GmbH" mit wenigen Beispielsätzen an
```

## Befehle

| Befehl | Zweck |
| --- | --- |
| `pnpm dev` | Entwicklungsserver |
| `pnpm build` / `pnpm start` | Produktionsbuild und -server |
| `pnpm start:migrate` | Migrationen anwenden und Server starten (Deployment-Startbefehl) |
| `pnpm lint` | ESLint über den gesamten Quellcode |
| `pnpm typecheck` | TypeScript für App sowie Tests und E2E |
| `pnpm test` | Unit- und Integrationstests (Vitest, echte Datenbank) |
| `pnpm test:e2e` | End-to-End-Tests (Playwright gegen echten Server) |
| `pnpm db:migrate` / `pnpm db:deploy` | Migrationen entwickeln / ausrollen |
| `pnpm db:studio` | Prisma Studio |
| `pnpm brand:build` | Brand-Assets aus den Marken-Komponenten erzeugen |
| `pnpm seed:demo` | Demo-Organisation für lokale Entwicklung |
| `pnpm backfill:active-crm` | Bestandsdaten einmalig mit der Next Action Engine abgleichen |

## Tech-Stack

- **Next.js 15** (App Router, React 19, Server Components)
- **TypeScript** im Strict Mode
- **PostgreSQL** mit **Prisma 7** (`@prisma/adapter-pg`)
- **Tailwind CSS 4** mit zentralen Design-Tokens
- **Zod** für Validierung auf Client und Server
- **Vitest** (Integration gegen echte DB) und **Playwright** (E2E)

## Dokumentation

| Dokument | Inhalt |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architektur, Datenmodell, Auth, Mandanten, Workflows, Grenzen |
| [docs/ACTIVE-CRM.md](docs/ACTIVE-CRM.md) | Next Action Engine: Ereignisse, Regeln, Zustände, Automationen, Anbindung |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Beziehungen der Objekte und die Entscheidungen dahinter |
| [docs/BRANDING.md](docs/BRANDING.md) | Marke, Design-Tokens, Assets, White-Label-Vorbereitung |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Betrieb, Umgebungsvariablen, Deployment, Backups |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | Abnahmeprotokoll: was verifiziert ist und was offen bleibt |

## Ehrlichkeit über den Funktionsstand

Dieses Produkt zeigt nichts an, was es nicht tut:

- **E-Mail-Versand** braucht einen verbundenen Anbieter. Solange keiner
  verbunden ist, wird die E-Mail als Entwurf gespeichert und die Oberfläche
  nennt den Grund – es gibt keinen Senden-Button, der ins Leere läuft.
- **Integrationen** (Google, Microsoft, Slack, Stripe, Calendly) sind als
  Adapter-Architektur vorbereitet und im Katalog ausdrücklich als „noch nicht
  implementiert" gekennzeichnet. Ausgehende **Webhooks** sind vollständig
  implementiert.
- **Zwei-Faktor-Authentifizierung** ist im Datenmodell und in der Sitzungsprüfung
  vorbereitet, die Selbsteinrichtung folgt später.
- **Automatische Nachrichten an Kunden** verschickt das System nicht von sich
  aus. Automatisiert werden interne Erinnerungen; jede geplante Automation
  prüft ihre Bedingungen unmittelbar vor der Ausführung erneut und wird mit
  Begründung übersprungen, wenn sich die Lage geändert hat.
- **Der Zeitablauf** (fällige Aktionen, Stagnation) braucht einen Scheduler,
  der `POST /api/v1/scheduler/run` aufruft – siehe
  [docs/OPERATIONS.md](docs/OPERATIONS.md).
- Eine Liste offener Punkte steht in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).
