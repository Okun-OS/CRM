import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 configuration. The connection URL lives here (not in the schema).
 *
 * It is read directly from the environment instead of Prisma's `env()` helper,
 * because that helper throws while the config file is being loaded — which
 * would break every command, including the ones that need no database at all.
 * `prisma generate` runs during the production image build, where no database
 * is reachable; only `migrate`, `db` and `studio` need a URL, and those fail
 * with a clear message of their own when it is missing.
 */
const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  ...(url ? { datasource: { url } } : {}),
});
