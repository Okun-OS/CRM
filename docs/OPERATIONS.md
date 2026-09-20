# Betrieb

Diese Anleitung beschreibt, was für einen produktiven Betrieb von OKUN CRM
nötig ist.

---

## 1. Voraussetzungen

- **Node.js 22** oder neuer
- **PostgreSQL 14** oder neuer
- **pnpm** (empfohlen; `corepack enable`)

Die Node-Anforderung ist keine Empfehlung, sondern eine harte Grenze: Prisma 7
verlangt `^20.19 || ^22.12 || >=24.0` und bricht sonst schon beim Installieren
ab. Sie steht deshalb in `package.json` unter `engines` und zusätzlich als `22`
in `.nvmrc`, damit Buildsysteme dieselbe Version wählen.

## 2. Umgebungsvariablen

Vorlage: `.env.example`.

| Variable | Pflicht | Bedeutung |
| --- | --- | --- |
| `DATABASE_URL` | ja | PostgreSQL-Verbindung für Prisma und den pg-Adapter |
| `APP_URL` | ja | Öffentliche Basis-URL; wird für Einladungslinks verwendet |
| `SESSION_SECRET` | ja | Mindestens 16 Zeichen. **Rotation meldet alle Sitzungen ab.** |
| `ENCRYPTION_KEY` | ja | AES-256-GCM-Schlüssel für Integrationsgeheimnisse. **Rotation macht gespeicherte Integrationszugänge unlesbar** – danach neu verbinden. |
| `STORAGE_DRIVER` | nein | Derzeit `local` |
| `STORAGE_LOCAL_PATH` | nein | Ablagepfad für Dateien (Standard `./storage`) |
| `TRUST_PROXY` | nein | `1` nur hinter einem vertrauenswürdigen Proxy: erst dann wird `X-Forwarded-For` ausgewertet |
| `NODE_ENV` | ja | `production` im Betrieb (aktiviert HSTS und strengere CSP) |

Schlüssel erzeugen:

```bash
openssl rand -base64 32
```

Geheimnisse gehören in die Secret-Verwaltung der Plattform, nicht ins Repository.
`.env` ist per `.gitignore` ausgeschlossen.

## 3. Deployment

```bash
pnpm install --frozen-lockfile
pnpm db:deploy                  # prisma migrate deploy
pnpm build
pnpm start                      # oder: next start -p $PORT
```

Die Anwendung läuft als Node-Prozess (Server Components, Datei-Uploads und der
pg-Adapter brauchen die Node-Runtime – kein Edge-Deployment).

Hinter einem Reverse Proxy:

- TLS terminieren, HTTP auf HTTPS umleiten.
- `X-Forwarded-For` setzen und `TRUST_PROXY=1` konfigurieren, damit IP-Angaben
  im Audit Log stimmen.
- Upload-Limit mindestens 25 MB zulassen (`client_max_body_size`).

### Build ohne Datenbank

Der Build braucht **keine** Datenbankverbindung. `prisma generate` erzeugt nur
den Client aus dem Schema, und alle Seiten sind serverseitig dynamisch, es wird
also nichts vorgerendert. Entsprechend liest `prisma.config.ts` die
`DATABASE_URL` direkt aus der Umgebung, statt sie beim Laden der Konfiguration
zu erzwingen — sonst scheitert jeder Build in einer Umgebung, in der die
Variable erst zur Laufzeit gesetzt wird.

Damit das trägt, wird der Prisma-Client erst beim ersten Zugriff erzeugt und
nicht beim Import von `src/lib/db.ts`: Beim Sammeln der Seitendaten lädt Next
jeden Route-Handler, und ein beim Import erzeugter Client würde dort eine
Datenbank verlangen, die es in der Bauumgebung nicht gibt.

### Prüfen wie das Buildsystem

Ein Build im Arbeitsverzeichnis beweist wenig: Dort liegen `.env`, ein warmer
`.next`-Cache und Dateien, die vielleicht gar nicht im Repository sind. Vor
einem Deployment deshalb gegen einen frischen Klon prüfen — genau das, was das
Buildsystem auscheckt:

```bash
git clone --depth 1 --branch <branch> <repo-url> /tmp/buildcheck
cd /tmp/buildcheck
pnpm install --frozen-lockfile
env -u DATABASE_URL -u SESSION_SECRET -u ENCRYPTION_KEY pnpm build
```

Dieser Lauf hat vier Fehler gefunden, die lokal unsichtbar waren: eine durch
`.gitignore` nie eingecheckte Quelldatei, die Auswertung der Umgebung beim
Import, eine zu alte Node-Version und die zur Bauzeit von Google Fonts
geladene Schriftart.

Der Build kommt zudem ohne Netzwerk aus: Die Schriftart liegt als woff2 im
Repository (`src/app/fonts/`, SIL Open Font License 1.1) und wird über
`next/font/local` eingebunden. `next/font/google` würde sie bei jedem Build
erneut abrufen.

Zur **Laufzeit** ist die Datenbank zwingend: `DATABASE_URL`, `SESSION_SECRET`
und `ENCRYPTION_KEY` müssen gesetzt sein, sonst bricht der erste Request mit
„Invalid environment configuration" ab (Abschnitt 2).

### Railway

Im Repository liegen `Dockerfile` und `railway.json`. Gebaut wird bewusst mit
dem eigenen Dockerfile und nicht mit Nixpacks: Node-Version, Paketmanager und
Buildschritte stehen damit im Repository und sind dieselben wie lokal geprüft.
Gestartet wird mit `pnpm start:migrate` (`prisma migrate deploy && next start`),
sodass jedes Deployment die Migrationen vorab anwendet. Healthcheck ist
`/login`, weil `/` auf die Anmeldung umleitet (307).

`NODE_ENV` darf dabei ein beliebiger Wert sein: Die Anwendung behandelt alles
außer `development` und `test` als Produktion, statt über ein Etikett zu
scheitern.

Damit das Deployment läuft, im Railway-Projekt:

1. **PostgreSQL-Service hinzufügen** (Add Service → Database → PostgreSQL).
2. Beim CRM-Service unter *Variables* setzen:

   | Variable | Wert |
   | --- | --- |
   | `DATABASE_URL` | **Referenz** auf die Datenbank, wörtlich `${{Postgres.DATABASE_URL}}` — keine abgetippte Verbindung. Ein Wert mit `localhost` ist in einem Container immer falsch: Dort ist `localhost` die Anwendung selbst, die Datenbank läuft als eigener Dienst. Der Start bricht in diesem Fall mit einer erklärenden Meldung ab statt mit einem rohen Prisma-Fehler. |
   | `SESSION_SECRET` | `openssl rand -base64 32` |
   | `ENCRYPTION_KEY` | `openssl rand -base64 32` |
   | `APP_URL` | die öffentliche Domain des Dienstes, z. B. `https://crm.example.com` |
   | `NODE_ENV` | `production` |
   | `TRUST_PROXY` | `1` (Railway terminiert TLS und setzt `X-Forwarded-For`) |

3. **Dateiablage beachten:** Der Container hat kein dauerhaftes Dateisystem.
   Für Uploads ein Railway-Volume einhängen und `STORAGE_LOCAL_PATH` darauf
   zeigen lassen — sonst gehen hochgeladene Dateien bei jedem Deployment
   verloren. Ohne Volume bleibt der Rest des Produkts funktionsfähig.
4. **Kein Autoscaling über eine Instanz hinaus**, solange Rate Limiting im
   Prozessspeicher liegt und die Dateiablage lokal ist (Abschnitt 8).

`prisma` und `dotenv` stehen bewusst in den `dependencies`: Der Startbefehl
ruft die Prisma-CLI auf, und Buildsysteme entfernen `devDependencies` im
Laufzeit-Image.

### Dateiablage

Mit `STORAGE_DRIVER=local` schreibt die Anwendung nach `STORAGE_LOCAL_PATH`.
Bei mehreren Instanzen muss dieses Verzeichnis geteilt werden (NFS o. ä.) oder
ein Objekt-Storage-Treiber ergänzt werden (`src/server/storage/driver.ts`
definiert den Vertrag: `put`, `get`, `remove`).

## 4. Migrationen

- Entwicklung: `pnpm db:migrate` erzeugt und wendet eine Migration an.
- Betrieb: `pnpm db:deploy` wendet ausstehende Migrationen an.
- Migrationen sind versioniert und liegen in `prisma/migrations`.
- Vor jedem Deployment mit Schemaänderung: **Backup einspielen können.**
  Für Rückwärtskompatibilität empfiehlt sich der zweistufige Weg
  (erst additive Migration ausrollen, Code nachziehen, dann aufräumen).
- Bestehende Daten werden nie ungeprüft gelöscht; destruktive Schritte gehören
  in eine eigene, dokumentierte Migration.

## 5. Wiederkehrende Aufgaben

Ein Scheduler (Cron, systemd-Timer, Plattform-Job) sollte regelmäßig aufrufen:

| Aufgabe | Funktion | Empfohlener Takt |
| --- | --- | --- |
| Webhook-Wiederholungen | `retryPendingWebhookDeliveries()` aus `src/server/services/webhooks.ts` | alle 5 Minuten |
| Durchlauf des aktiven CRM | `POST /api/v1/scheduler/run` | alle 15 Minuten |

Ohne den Webhook-Job bleiben fehlgeschlagene Zustellungen im Status „in
Wiederholung"; die Oberfläche unter Einstellungen → System zeigt das an.

Der Durchlauf des aktiven CRM prüft fällige nächste Aktionen, erkennt
Stagnation und führt geplante Automationen aus. Er wird mit einem API-Key mit
dem Scope `scheduler:run` aufgerufen (Einstellungen → API-Keys) und gilt immer
genau für die Organisation dieses Schlüssels — bei mehreren Mandanten also ein
Schlüssel und ein Job je Organisation:

```bash
curl -sS -X POST "$APP_URL/api/v1/scheduler/run" \
  -H "Authorization: Bearer $OKUN_SCHEDULER_KEY"
```

Der Aufruf ist gefahrlos wiederholbar: Jede Automation wird vor der Ausführung
beansprucht, und der Abgleich ist idempotent. Ohne diesen Job reagiert das
System weiterhin auf Ereignisse, aber nicht auf reinen Zeitablauf — Fristen
und Stagnation bleiben dann liegen.

### Einmalig: Bestandsdaten nachziehen

Datensätze, die vor der Next Action Engine angelegt wurden, tragen noch keinen
operativen Zustand. Ein Durchlauf holt das nach:

```bash
DATABASE_URL=… pnpm backfill:active-crm
```

Das Skript gleicht ausschließlich ab — es führt keine Automation aus und
versendet nichts. Es ist gefahrlos wiederholbar.

## 6. Backups

- **Datenbank**: regelmäßige Dumps (`pg_dump`), Wiederherstellung testen.
- **Dateien**: `STORAGE_LOCAL_PATH` mitsichern – Datenbank und Dateien gehören
  zum selben Wiederherstellungspunkt.

## 7. Betriebskennzahlen

Unter **Einstellungen → System** stehen aktive Workflows, fehlgeschlagene
Ausführungen und der Zustand der Webhook-Zustellung. Anwendungsseitige Logs
werden als eine JSON-Zeile je Ereignis ausgegeben (`src/lib/logger.ts`);
Passwörter, Tokens und Secrets werden dabei redigiert.

## 8. Skalierung

Der Prozess ist zustandslos bis auf zwei Punkte:

1. **Rate Limiting** liegt im Prozessspeicher. Bei mehreren Instanzen ist die
   Begrenzung pro Instanz wirksam; für eine gemeinsame Zählung ist
   `consumeRateLimit` auf einen geteilten Speicher umzustellen.
2. **Dateiablage** siehe oben.

Sitzungen liegen in der Datenbank und funktionieren über Instanzen hinweg.

## 9. Tests im CI

```bash
pnpm lint
pnpm typecheck
pnpm test          # benötigt eine PostgreSQL-Instanz (TEST_DATABASE_URL)
pnpm build
pnpm test:e2e      # startet den gebauten Server selbst (E2E_DATABASE_URL)
```

Für eine lokale Datenbank inklusive Test- und E2E-Datenbank:

```bash
./scripts/dev-db.sh
```

Die Testdatenbanken müssen leer angelegt werden können; Migrationen werden von
den Suiten selbst angewendet.
