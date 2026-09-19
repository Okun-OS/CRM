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
 *
 * The client is created on first use, not when this module is imported. That
 * matters during `next build`: collecting page data loads every route handler,
 * and a client built at import time would demand DATABASE_URL, SESSION_SECRET
 * and ENCRYPTION_KEY in an environment that has no database at all. Nothing is
 * queried at build time, so nothing should be connected either.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

let instance: PrismaClient | null = null;

function client(): PrismaClient {
  if (instance) return instance;

  instance =
    globalForPrisma.prisma ??
    new PrismaClient({
      adapter: new PrismaPg({ connectionString: env().DATABASE_URL }),
      log: env().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });

  // In development the singleton survives hot reloads; in production each
  // process builds its own.
  if (env().NODE_ENV !== "production") globalForPrisma.prisma = instance;
  return instance;
}

/**
 * Behaves exactly like a `PrismaClient` at every call site — `prisma.deal`,
 * `prisma.$transaction(…)` — but resolves to the real client on first access.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const resolved = client();
    const value = resolved[property as keyof PrismaClient];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(resolved) : value;
  },
  has(_target, property) {
    return property in client();
  },
});

/** The transactional client handed to callbacks by `prisma.$transaction`. */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
