import type { ActorContext } from "./context";
import { NotFound } from "./api/errors";

/**
 * Tenant scoping helpers.
 *
 * Rule: no service may query a tenant table without spreading `scope(ctx)` (or
 * an equivalent explicit organizationId) into the `where` clause. Tests in
 * `tests/tenant-isolation.test.ts` assert this holds for every CRM object.
 */
export function scope(ctx: ActorContext) {
  return { organizationId: ctx.organizationId };
}

/** Scope that also hides soft-deleted rows. */
export function liveScope(ctx: ActorContext) {
  return { organizationId: ctx.organizationId, deletedAt: null };
}

export function assertFound<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) throw NotFound(message);
  return value;
}
