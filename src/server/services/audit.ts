import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope } from "@/lib/tenant";
import { paginate, paginationSchema, skipTake } from "@/lib/api/pagination";

/** Read access to the audit trail. Entries are append-only — never edited. */
export const auditQuerySchema = paginationSchema.extend({
  actorId: z.string().max(30).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(30).optional(),
  action: z.string().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export async function listAuditLog(ctx: ActorContext, query: z.infer<typeof auditQuerySchema>) {
  assertPermission(ctx, "audit.read");

  const where = {
    ...scope(ctx),
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.action ? { action: { contains: query.action, mode: "insensitive" as const } } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...skipTake(query),
      include: { actor: { select: { id: true, name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return paginate(
    rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actor: row.actor,
      actorEmail: row.actorEmail,
      before: row.before,
      after: row.after,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    query,
  );
}

/** Timeline of changes for a single record, used on detail pages. */
export async function entityAuditTrail(ctx: ActorContext, entityType: string, entityId: string, limit = 20) {
  assertPermission(ctx, "audit.read");
  const rows = await prisma.auditLog.findMany({
    where: { ...scope(ctx), entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { id: true, name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actor: row.actor,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt.toISOString(),
  }));
}
