# OKUN CRM

**Kunden. Beziehungen. Wachstum.**
Ein Produkt von **OKUN Software**.

OKUN CRM verbindet Menschen, Prozesse und Chancen in einer Plattform: Kontakte,
Unternehmen, Leads, Deals, Aktivitäten, Aufgaben, Termine, E-Mail-Vorlagen,
Automatisierung, Auswertungen und Administration – mandantenfähig und mit
serverseitig durchgesetzten Berechtigungen.

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
| `pnpm typecheck` | TypeScript für App sowie Tests und E2E |
| `pnpm test` | Unit- und Integrationstests (Vitest, echte Datenbank) |
| `pnpm test:e2e` | End-to-End-Tests (Playwright gegen echten Server) |
| `pnpm db:migrate` / `pnpm db:deploy` | Migrationen entwickeln / ausrollen |
| `pnpm db:studio` | Prisma Studio |
| `pnpm brand:build` | Brand-Assets aus den Marken-Komponenten erzeugen |
| `pnpm seed:demo` | Demo-Organisation für lokale Entwicklung |

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
- Eine Liste offener Punkte steht in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).
