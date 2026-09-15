import { z } from "zod";
import type { NotificationType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { ActorContext } from "@/lib/context";
import { scope } from "@/lib/tenant";
import { logError } from "@/lib/logger";
import { paginate, paginationSchema, skipTake } from "@/lib/api/pagination";

/**
 * In-app notifications. Delivery never blocks the triggering action; a failed
 * notification is logged rather than surfaced as a request error.
 */
export async function notify(
  ctx: ActorContext,
  input: {
    userId: string;
    type: NotificationType;
    title: string;
    body?: string;
    link?: string;
    entityType?: string;
    entityId?: string;
  },
): Promise<void> {
  try {
    const membership = await prisma.membership.findFirst({
      where: { userId: input.userId, organizationId: ctx.organizationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!membership) return;

    await prisma.notification.create({
      data: {
        organizationId: ctx.organizationId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });
  } catch (error) {
    logError("notification.create_failed", error, { type: input.type });
  }
}

export const notificationQuerySchema = paginationSchema.extend({
  unreadOnly: z.coerce.boolean().default(false),
});

export async function listNotifications(ctx: ActorContext, query: z.infer<typeof notificationQuerySchema>) {
  const where = {
    ...scope(ctx),
    userId: ctx.userId,
    ...(query.unreadOnly ? { readAt: null } : {}),
  };

  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, ...skipTake(query) }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...scope(ctx), userId: ctx.userId, readAt: null } }),
  ]);

  const page = paginate(
    rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      link: row.link,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    query,
  );

  return { ...page, unread };
}

export async function markNotificationRead(ctx: ActorContext, id: string) {
  await prisma.notification.updateMany({
    where: { id, ...scope(ctx), userId: ctx.userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(ctx: ActorContext) {
  await prisma.notification.updateMany({
    where: { ...scope(ctx), userId: ctx.userId, readAt: null },
    data: { readAt: new Date() },
  });
}
