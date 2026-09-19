# Produktionsabbild für OKUN CRM.
#
# Bewusst explizit statt automatisch erzeugt: Node-Version, Paketmanager,
# Installations- und Buildschritte stehen hier und sind damit dieselben wie
# lokal geprüft. Ein Build braucht keine Datenbank und kein Netzwerk über die
# Paketquellen hinaus — die Schriftart liegt im Repository.
FROM node:22-slim

# OpenSSL wird von der Prisma-Engine benötigt.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
RUN corepack enable

WORKDIR /app

# Abhängigkeiten zuerst: Diese Schicht wird nur bei Änderungen an Manifest
# oder Lockfile neu gebaut.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# prisma generate && next build
RUN pnpm build

EXPOSE 3000
# Migrationen vor dem Start anwenden; beides braucht DATABASE_URL zur Laufzeit.
CMD ["pnpm", "start:migrate"]
