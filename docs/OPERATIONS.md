# Betrieb

Diese Anleitung beschreibt, was für einen produktiven Betrieb von OKUN CRM
nötig ist.

---

## 1. Voraussetzungen

- **Node.js 22** oder neuer
- **PostgreSQL 14** oder neuer
- **pnpm** (empfohlen; `corepack enable`)

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

Ohne diesen Job bleiben fehlgeschlagene Zustellungen im Status „in
Wiederholung"; die Oberfläche unter Einstellungen → System zeigt das an.

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
pnpm typecheck
pnpm test          # benötigt eine PostgreSQL-Instanz (TEST_DATABASE_URL)
pnpm build
pnpm test:e2e      # startet den gebauten Server selbst (E2E_DATABASE_URL)
```

Die Testdatenbanken müssen leer angelegt werden können; Migrationen werden von
den Suiten selbst angewendet.
