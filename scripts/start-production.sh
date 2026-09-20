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

# Nur im Betrieb: Lokal ist localhost der richtige Wert.
case "${NODE_ENV:-}:${DATABASE_URL}" in
  production:*@localhost:*|production:*@127.0.0.1:*)
    echo "FEHLER: DATABASE_URL zeigt auf localhost." >&2
    echo "In einem Container ist localhost der Container selbst — die Datenbank" >&2
    echo "läuft als eigener Dienst. Auf Railway die Variable des CRM-Dienstes auf" >&2
    echo "\${{Postgres.DATABASE_URL}} setzen; der Wert aus .env.example ist nur ein" >&2
    echo "Platzhalter für die lokale Entwicklung." >&2
    exit 1
    ;;
esac

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

exec pnpm exec next start
