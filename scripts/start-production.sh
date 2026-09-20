#!/usr/bin/env sh
# Startet OKUN CRM im Betrieb: Migrationen anwenden, dann den Server.
#
# Zwei Dinge gehen hier regelmäßig schief, und beide sollen sich selbst
# erklären, statt als roher Prisma-Fehler im Deploy-Log zu landen:
# eine DATABASE_URL, die noch auf den Platzhalter zeigt, und ein privates
# Netz der Plattform, das beim Start des Containers noch nicht bereit ist.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "FEHLER: DATABASE_URL ist nicht gesetzt." >&2
  echo "Auf Railway: Variable des CRM-Dienstes auf \${{Postgres.DATABASE_URL}} setzen" >&2
  echo "(Referenz auf den Datenbankdienst, nicht die Verbindung abtippen)." >&2
  exit 1
fi

# Eine DATABASE_URL, die auf localhost zeigt, ist hier fast immer der
# Platzhalter aus .env.example. Der Abbruch hängt bewusst NICHT an
# NODE_ENV: Plattformen setzen dort eigene Werte, und genau deshalb lief
# diese Prüfung schon einmal ins Leere. Wer lokal wirklich gegen localhost
# starten will, setzt NODE_ENV=development/test oder ALLOW_LOCALHOST_DB=1.
case "${NODE_ENV:-}" in
  development|test) localhost_allowed=1 ;;
  *) localhost_allowed="${ALLOW_LOCALHOST_DB:-0}" ;;
esac

case "${localhost_allowed}:${DATABASE_URL}" in
  0:*@localhost:*|0:*@127.0.0.1:*|0:*@::1:*)
    echo "FEHLER: DATABASE_URL zeigt auf localhost." >&2
    echo "In einem Container ist localhost der Container selbst — die Datenbank" >&2
    echo "läuft als eigener Dienst. Auf Railway die Variable des CRM-Dienstes auf" >&2
    echo "\${{Postgres.DATABASE_URL}} setzen; der Wert aus .env.example ist nur ein" >&2
    echo "Platzhalter für die lokale Entwicklung." >&2
    echo "" >&2
    echo "Aktueller Wert (ohne Zugangsdaten): $(echo "$DATABASE_URL" | sed 's#://[^@]*@#://***@#')" >&2
    exit 1
    ;;
esac

# Geheimnisse: ohne sie startet die Anwendung zwar, aber jede Anfrage, die
# die Datenbank berührt, scheitert — ein Zustand, der von außen wie ein
# Anwendungsfehler aussieht. Lieber gar nicht erst starten.
missing=""
for name in SESSION_SECRET ENCRYPTION_KEY; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    missing="$missing $name (fehlt)"
  elif [ "${#value}" -lt 16 ]; then
    missing="$missing $name (zu kurz, mindestens 16 Zeichen)"
  fi
done

if [ -n "$missing" ]; then
  echo "FEHLER: Unvollständige Konfiguration:$missing" >&2
  echo "" >&2
  echo "Beide Werte einmalig erzeugen und als Variablen setzen:" >&2
  echo "  openssl rand -base64 32" >&2
  echo "" >&2
  echo "SESSION_SECRET signiert Sitzungen — ein Wechsel meldet alle ab." >&2
  echo "ENCRYPTION_KEY verschlüsselt Integrationsgeheimnisse — ein Wechsel" >&2
  echo "macht bereits gespeicherte unlesbar. Jetzt setzen, später nicht mehr." >&2
  exit 1
fi

# Das private Netz mancher Plattformen steht erst wenige Sekunden nach dem
# Containerstart bereit. Ein sofortiger Verbindungsversuch scheitert dann,
# obwohl alles richtig konfiguriert ist.
attempt=1
max_attempts=5
until pnpm exec prisma migrate deploy; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "FEHLER: Migrationen nach $max_attempts Versuchen nicht anwendbar." >&2
    echo "Läuft der Datenbankdienst, und stimmt DATABASE_URL?" >&2
    exit 1
  fi
  wait_seconds=$((attempt * 3))
  echo "Datenbank noch nicht erreichbar — erneuter Versuch in ${wait_seconds}s ($attempt/$max_attempts)." >&2
  sleep "$wait_seconds"
  attempt=$((attempt + 1))
done

# An 0.0.0.0 binden, damit die Plattform den Container erreicht, und an den
# Port, den sie vorgibt — fällt sie darauf zurück, ist es 3000 (siehe
# Dockerfile). Beides explizit, damit der Port nicht davon abhängt, welche
# Variable die Plattform gerade setzt.
exec pnpm exec next start --hostname 0.0.0.0 --port "${PORT:-3000}"
