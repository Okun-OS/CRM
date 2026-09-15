import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import type { ActorContext } from "./context";
import { logError } from "./logger";

export type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

const SENSITIVE = /^(passwordHash|password|secret|secretCipher|tokenHash|csrfToken|twoFactorSecret)$/i;

function sanitize(value: Record<string, unknown> | null | undefined) {
  if (!value) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE.test(key)) continue;
    out[key] = val instanceof Date ? val.toISOString() : typeof val === "object" && val !== null ? JSON.parse(JSON.stringify(val)) : val;
  }
  return out;
}

/**
 * Records a security- or business-relevant change. Audit writes never fail the
 * originating operation — a failed audit is logged instead.
 */
export async function writeAudit(ctx: ActorContext, input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        actorEmail: ctx.email,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: (sanitize(input.before) ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (sanitize(input.after) ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });
  } catch (error) {
    logError("audit.write_failed", error, { action: input.action, entityType: input.entityType });
  }
}

/** Returns only the fields that actually changed, for compact audit entries. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown>; changed: string[] } {
  const changed: string[] = [];
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const beforeValue = before[key];
    const afterValue = after[key];
    if (afterValue === undefined) continue;
    const same =
      beforeValue instanceof Date && afterValue instanceof Date
        ? beforeValue.getTime() === afterValue.getTime()
        : JSON.stringify(beforeValue ?? null) === JSON.stringify(afterValue ?? null);
    if (!same) {
      changed.push(key);
      b[key] = beforeValue ?? null;
      a[key] = afterValue ?? null;
    }
  }
  return { before: b, after: a, changed };
}
