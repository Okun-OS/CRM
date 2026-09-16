// Fails the build if a client component ever imports the database, instead of
// silently bundling the pg driver for the browser.
import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

/**
 * Prisma client singleton.
 *
 * Every query in this application must be scoped to an organization. The
 * service layer is responsible for that scoping; see `src/lib/tenant.ts` for
 * the helpers and `tests/tenant-isolation.test.ts` for the guarantees.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env().DATABASE_URL }),
    log: env().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env().NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** The transactional client handed to callbacks by `prisma.$transaction`. */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
