import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { liveScope, scope } from "@/lib/tenant";

/**
 * Reporting.
 *
 * Every figure below is aggregated from the organization's own records. When
 * there is no data, the result is an empty series — never a placeholder value.
 */
export const reportRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  pipelineId: z.string().max(30).optional(),
  ownerId: z.string().max(30).optional(),
});

export type ReportRange = z.infer<typeof reportRangeSchema>;

function resolveRange(range: ReportRange) {
  const to = range.to ?? new Date();
  const from = range.from ?? new Date(to.getFullYear(), to.getMonth() - 5, 1);
  return { from, to };
}

/** KPI header + working lists for the dashboard. */
export async function dashboardSummary(ctx: ActorContext) {
  assertPermission(ctx, "contacts.read");

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [
    contacts,
    newContacts,
    openDeals,
    openValue,
    wonThisMonth,
    lostThisMonth,
    newLeads,
    activitiesToday,
    openTasks,
    overdueTasks,
    upcomingMeetings,
  ] = await Promise.all([
    prisma.contact.count({ where: liveScope(ctx) }),
    prisma.contact.count({ where: { ...liveScope(ctx), createdAt: { gte: thirtyDaysAgo } } }),
    prisma.deal.count({ where: { ...liveScope(ctx), status: "OPEN" } }),
    prisma.deal.aggregate({ where: { ...liveScope(ctx), status: "OPEN" }, _sum: { amount: true } }),
    prisma.deal.aggregate({
      where: { ...liveScope(ctx), status: "WON", closedAt: { gte: startOfMonth } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.deal.count({ where: { ...liveScope(ctx), status: "LOST", closedAt: { gte: startOfMonth } } }),
    prisma.lead.count({ where: { ...liveScope(ctx), createdAt: { gte: thirtyDaysAgo } } }),
    prisma.activity.count({ where: { ...scope(ctx), occurredAt: { gte: startOfDay, lte: endOfDay } } }),
    prisma.task.count({ where: { ...scope(ctx), deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.task.count({
      where: { ...scope(ctx), deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lt: now } },
    }),
    prisma.meeting.count({
      where: { ...scope(ctx), deletedAt: null, startAt: { gte: now, lte: new Date(now.getTime() + 7 * 86_400_000) } },
    }),
  ]);

  const closedThisMonth = wonThisMonth._count._all + lostThisMonth;

  return {
    contacts,
    newContacts,
    newLeads,
    openDeals,
    pipelineValue: Number(openValue._sum.amount ?? 0),
    wonThisMonth: wonThisMonth._count._all,
    wonValueThisMonth: Number(wonThisMonth._sum.amount ?? 0),
    winRate: closedThisMonth === 0 ? null : Math.round((wonThisMonth._count._all / closedThisMonth) * 100),
    activitiesToday,
    openTasks,
    overdueTasks,
    upcomingMeetings,
  };
}

/** Deal count and value per stage of a pipeline — the funnel. */
export async function pipelineFunnel(ctx: ActorContext, pipelineId?: string) {
  assertPermission(ctx, "deals.read");

  const pipeline = pipelineId
    ? await prisma.pipeline.findFirst({ where: { id: pipelineId, ...scope(ctx) }, include: { stages: { orderBy: { position: "asc" } } } })
    : await prisma.pipeline.findFirst({
        where: { ...scope(ctx), isArchived: false },
        include: { stages: { orderBy: { position: "asc" } } },
        orderBy: [{ isDefault: "desc" }, { position: "asc" }],
      });
  if (!pipeline) return { pipeline: null, stages: [] };

  const grouped = await prisma.deal.groupBy({
    by: ["stageId"],
    where: { ...liveScope(ctx), pipelineId: pipeline.id },
    _count: { _all: true },
    _sum: { amount: true },
    orderBy: { stageId: "asc" },
  });
  const byStage = new Map(grouped.map((row) => [row.stageId, row]));

  return {
    pipeline: { id: pipeline.id, name: pipeline.name },
    stages: pipeline.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      type: stage.type,
      count: byStage.get(stage.id)?._count._all ?? 0,
      amount: Number(byStage.get(stage.id)?._sum.amount ?? 0),
    })),
  };
}

/** Won / lost / created deals per month. */
export async function dealsOverTime(ctx: ActorContext, range: ReportRange) {
  assertPermission(ctx, "reports.read");
  const { from, to } = resolveRange(range);

  const deals = await prisma.deal.findMany({
    where: {
      ...liveScope(ctx),
      ...(range.pipelineId ? { pipelineId: range.pipelineId } : {}),
      ...(range.ownerId ? { ownerId: range.ownerId } : {}),
      OR: [{ createdAt: { gte: from, lte: to } }, { closedAt: { gte: from, lte: to } }],
    },
    select: { amount: true, status: true, createdAt: true, closedAt: true },
  });

  const buckets = new Map<string, { month: string; created: number; won: number; lost: number; wonValue: number }>();
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, { month: key, created: 0, won: 0, lost: 0, wonValue: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const keyOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

  for (const deal of deals) {
    const createdKey = keyOf(deal.createdAt);
    if (buckets.has(createdKey) && deal.createdAt >= from && deal.createdAt <= to) {
      buckets.get(createdKey)!.created += 1;
    }
    if (deal.closedAt && deal.closedAt >= from && deal.closedAt <= to) {
      const closedKey = keyOf(deal.closedAt);
      const bucket = buckets.get(closedKey);
      if (bucket) {
        if (deal.status === "WON") {
          bucket.won += 1;
          bucket.wonValue += Number(deal.amount);
        }
        if (deal.status === "LOST") bucket.lost += 1;
      }
    }
  }

  return Array.from(buckets.values());
}

/** Weighted pipeline forecast by expected close month. */
export async function salesForecast(ctx: ActorContext, range: ReportRange) {
  assertPermission(ctx, "reports.read");

  const deals = await prisma.deal.findMany({
    where: {
      ...liveScope(ctx),
      status: "OPEN",
      expectedCloseDate: { not: null },
      ...(range.pipelineId ? { pipelineId: range.pipelineId } : {}),
      ...(range.ownerId ? { ownerId: range.ownerId } : {}),
    },
    select: { amount: true, probability: true, expectedCloseDate: true, stage: { select: { probability: true } } },
  });

  const buckets = new Map<string, { month: string; total: number; weighted: number; count: number }>();
  for (const deal of deals) {
    if (!deal.expectedCloseDate) continue;
    const key = `${deal.expectedCloseDate.getFullYear()}-${String(deal.expectedCloseDate.getMonth() + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key) ?? { month: key, total: 0, weighted: 0, count: 0 };
    const amount = Number(deal.amount);
    const probability = (deal.probability ?? deal.stage.probability) / 100;
    bucket.total += amount;
    bucket.weighted += amount * probability;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values()).sort((a, b) => a.month.localeCompare(b.month));
}

/** Where leads and deals come from. */
export async function sourceBreakdown(ctx: ActorContext) {
  assertPermission(ctx, "reports.read");

  const [leadSources, dealSources] = await Promise.all([
    prisma.lead.groupBy({
      by: ["source"],
      where: liveScope(ctx),
      _count: { _all: true },
      orderBy: { _count: { source: "desc" } },
      take: 10,
    }),
    prisma.deal.groupBy({
      by: ["source"],
      where: liveScope(ctx),
      _count: { _all: true },
      _sum: { amount: true },
      orderBy: { _count: { source: "desc" } },
      take: 10,
    }),
  ]);

  return {
    leads: leadSources.map((row) => ({ source: row.source ?? "Ohne Quelle", count: row._count._all })),
    deals: dealSources.map((row) => ({
      source: row.source ?? "Ohne Quelle",
      count: row._count._all,
      amount: Number(row._sum.amount ?? 0),
    })),
  };
}

/** Per-owner sales performance. */
export async function salesPerformance(ctx: ActorContext, range: ReportRange) {
  assertPermission(ctx, "reports.read");
  const { from, to } = resolveRange(range);

  const [won, open, activities, members] = await Promise.all([
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: { ...liveScope(ctx), status: "WON", closedAt: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { amount: true },
      orderBy: { ownerId: "asc" },
    }),
    prisma.deal.groupBy({
      by: ["ownerId"],
      where: { ...liveScope(ctx), status: "OPEN" },
      _count: { _all: true },
      _sum: { amount: true },
      orderBy: { ownerId: "asc" },
    }),
    prisma.activity.groupBy({
      by: ["actorId"],
      where: { ...scope(ctx), occurredAt: { gte: from, lte: to }, type: { not: "SYSTEM" } },
      _count: { _all: true },
      orderBy: { actorId: "asc" },
    }),
    prisma.membership.findMany({
      where: { ...scope(ctx), status: "ACTIVE" },
      select: { user: { select: { id: true, name: true } } },
    }),
  ]);

  const wonByOwner = new Map(won.map((row) => [row.ownerId, row]));
  const openByOwner = new Map(open.map((row) => [row.ownerId, row]));
  const activityByUser = new Map(activities.map((row) => [row.actorId, row._count._all]));

  return members
    .map(({ user }) => ({
      userId: user.id,
      name: user.name,
      wonDeals: wonByOwner.get(user.id)?._count._all ?? 0,
      wonValue: Number(wonByOwner.get(user.id)?._sum.amount ?? 0),
      openDeals: openByOwner.get(user.id)?._count._all ?? 0,
      openValue: Number(openByOwner.get(user.id)?._sum.amount ?? 0),
      activities: activityByUser.get(user.id) ?? 0,
    }))
    .sort((a, b) => b.wonValue - a.wonValue);
}

/** Average time a won deal spent in the pipeline, plus per-stage duration. */
export async function dealCycleTimes(ctx: ActorContext) {
  assertPermission(ctx, "reports.read");

  const [wonDeals, stageDurations] = await Promise.all([
    prisma.deal.findMany({
      where: { ...liveScope(ctx), status: "WON", closedAt: { not: null } },
      select: { createdAt: true, closedAt: true },
      take: 500,
      orderBy: { closedAt: "desc" },
    }),
    prisma.dealStageHistory.groupBy({
      by: ["fromStageId"],
      where: { ...scope(ctx), durationSeconds: { not: null }, fromStageId: { not: null } },
      _avg: { durationSeconds: true },
      _count: { _all: true },
      orderBy: { fromStageId: "asc" },
    }),
  ]);

  const durations = wonDeals
    .filter((deal) => deal.closedAt)
    .map((deal) => (deal.closedAt!.getTime() - deal.createdAt.getTime()) / 86_400_000);
  const averageDays = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null;

  const stageIds = stageDurations.map((row) => row.fromStageId).filter((id): id is string => Boolean(id));
  const stages = stageIds.length
    ? await prisma.pipelineStage.findMany({ where: { id: { in: stageIds }, ...scope(ctx) }, select: { id: true, name: true } })
    : [];
  const stageNames = new Map(stages.map((stage) => [stage.id, stage.name]));

  return {
    averageDaysToWin: averageDays === null ? null : Math.round(averageDays * 10) / 10,
    sampleSize: durations.length,
    stages: stageDurations
      .filter((row) => row.fromStageId && stageNames.has(row.fromStageId))
      .map((row) => ({
        stage: stageNames.get(row.fromStageId!)!,
        averageDays: Math.round(((row._avg.durationSeconds ?? 0) / 86_400) * 10) / 10,
        transitions: row._count._all,
      })),
  };
}

/** Activity volume by type over the range. */
export async function activityBreakdown(ctx: ActorContext, range: ReportRange) {
  assertPermission(ctx, "reports.read");
  const { from, to } = resolveRange(range);

  const grouped = await prisma.activity.groupBy({
    by: ["type"],
    where: { ...scope(ctx), occurredAt: { gte: from, lte: to } },
    _count: { _all: true },
    orderBy: { type: "asc" },
  });

  return grouped.map((row) => ({ type: row.type, count: row._count._all }));
}

/** Lead conversion funnel: created → qualified → converted. */
export async function leadConversion(ctx: ActorContext) {
  assertPermission(ctx, "reports.read");

  const [total, byStatus, converted] = await Promise.all([
    prisma.lead.count({ where: liveScope(ctx) }),
    prisma.lead.groupBy({
      by: ["status"],
      where: liveScope(ctx),
      _count: { _all: true },
      orderBy: { status: "asc" },
    }),
    prisma.lead.count({ where: { ...liveScope(ctx), convertedAt: { not: null } } }),
  ]);

  return {
    total,
    converted,
    conversionRate: total === 0 ? null : Math.round((converted / total) * 100),
    byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
  };
}
