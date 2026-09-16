#!/usr/bin/env bash
# Startet eine lokale PostgreSQL-Instanz für Entwicklung und Tests.
# Nur für lokale Entwicklung gedacht – im Betrieb wird eine verwaltete
# Datenbank verwendet (siehe docs/OPERATIONS.md).
set -euo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | tail -1)}"
PGDATA="${PGDATA:-/var/lib/okunpg}"
PGPORT="${PGPORT:-5433}"
PGSOCKET="${PGSOCKET:-/var/run/okunpg}"

mkdir -p "$PGSOCKET" "$(dirname "$PGDATA")"
chown -R postgres:postgres "$PGSOCKET" "$PGDATA" 2>/dev/null || true

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "Initialisiere Cluster in $PGDATA …"
  su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust"
fi

su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l /tmp/okunpg.log -o '-p $PGPORT -k $PGSOCKET -c listen_addresses=127.0.0.1' start" || true

for database in okun_crm okun_crm_test okun_crm_e2e; do
  psql -h 127.0.0.1 -p "$PGPORT" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$database'" \
    | grep -q 1 || createdb -h 127.0.0.1 -p "$PGPORT" -U postgres "$database"
done

echo "PostgreSQL läuft auf 127.0.0.1:$PGPORT (okun_crm, okun_crm_test, okun_crm_e2e)"
