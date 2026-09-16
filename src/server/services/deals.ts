import type { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { liveScope, scope, assertFound } from "@/lib/tenant";
import { paginate } from "@/lib/api/pagination";
import { writeAudit, diff } from "@/lib/audit";
import { emitDomainEvent, type DomainEventName } from "@/lib/events";
import { readValues } from "@/lib/properties";
import { listDefinitions, writeValues, assertRequiredProperties } from "@/server/services/property-store";
import { dealInputSchema, dealUpdateSchema, dealStageChangeSchema } from "@/lib/schemas/crm";
import { ValidationError } from "@/lib/api/errors";
import { buildListArgs, type ListQuery } from "./listing";
import { logSystemActivity } from "./activities";
import { assertOwnerInOrganization, assertRelationsExist, syncTags } from "./record-helpers";
import { notify } from "./notifications";

/** Deals — the sales opportunity, always inside exactly one pipeline stage. */
export type DealListItem = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  status: string;
  probability: number | null;
  expectedCloseDate: string | null;
  closedAt: string | null;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  pipeline: { id: string; name: string };
  stage: { id: string; name: string; type: string; probability: number };
  contacts: { id: string; name: string }[];
  lastActivityAt: string | null;
  createdAt: string;
  properties: Record<string, unknown>;
};

const listSelect = {
  id: true,
  name: true,
  amount: true,
  currency: true,
  status: true,
  probability: true,
  expectedCloseDate: true,
  closedAt: true,
  source: true,
  lastActivityAt: true,
  createdAt: true,
  company: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
  pipeline: { select: { id: true, name: true } },
  stage: { select: { id: true, name: true, type: true, probability: true, position: true } },
  contacts: { select: { contact: { select: { id: true, firstName: true, lastName: true } } }, take: 5 },
} as const;

type DealRow = {
  id: string;
  name: string;
  amount: unknown;
  currency: string;
  status: string;
  probability: number | null;
  expectedCloseDate: Date | null;
  closedAt: Date | null;
  lastActivityAt: Date | null;
  createdAt: Date;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  pipeline: { id: string; name: string };
  stage: { id: string; name: string; type: string; probability: number };
  contacts: { contact: { id: string; firstName: string; lastName: string } }[];
};

function mapDeal(row: DealRow, properties: Record<string, unknown> = {}): DealListItem {
  return {
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    probability: row.probability,
    expectedCloseDate: row.expectedCloseDate?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    company: row.company,
    owner: row.owner,
    pipeline: row.pipeline,
    stage: row.stage,
    contacts: row.contacts.map((link) => ({
      id: link.contact.id,
      name: `${link.contact.firstName} ${link.contact.lastName}`.trim(),
    })),
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    properties,
  };
}

export async function listDeals(ctx: ActorContext, query: ListQuery) {
  assertPermission(ctx, "deals.read");
  const args = await buildListArgs(ctx, "DEAL", query);

  const [rows, total, aggregate] = await Promise.all([
    prisma.deal.findMany({
      where: args.where as never,
      select: listSelect,
      orderBy: args.orderBy as never,
      skip: args.skip,
      take: args.take,
    }),
    prisma.deal.count({ where: args.where as never }),
    prisma.deal.aggregate({ where: args.where as never, _sum: { amount: true } }),
  ]);

  const ids = rows.map((row) => row.id);
  const [propertyValues, definitions] = await Promise.all([
    ids.length
      ? prisma.propertyValue.findMany({
          where: { organizationId: ctx.organizationId, objectType: "DEAL", dealId: { in: ids } },
        })
      : Promise.resolve([]),
    listDefinitions(ctx, "DEAL"),
  ]);

  const valuesByDeal = new Map<string, typeof propertyValues>();
  for (const value of propertyValues) {
    if (!value.dealId) continue;
    const bucket = valuesByDeal.get(value.dealId) ?? [];
    bucket.push(value);
    valuesByDeal.set(value.dealId, bucket);
  }

  const page = paginate(
    rows.map((row) => mapDeal(row as unknown as DealRow, readValues(definitions, valuesByDeal.get(row.id) ?? []))),
    total,
    args.pagination,
  );

  return { ...page, totalAmount: Number(aggregate._sum.amount ?? 0) };
}

/** Board view: all open deals of one pipeline, grouped by stage. */
export async function getPipelineBoard(ctx: ActorContext, pipelineId?: string) {
  assertPermission(ctx, "deals.read");

  const pipeline = pipelineId
    ? await prisma.pipeline.findFirst({
        where: { id: pipelineId, ...scope(ctx), isArchived: false },
        include: { stages: { orderBy: { position: "asc" } } },
      })
    : await prisma.pipeline.findFirst({
        where: { ...scope(ctx), isArchived: false },
        include: { stages: { orderBy: { position: "asc" } } },
        orderBy: [{ isDefault: "desc" }, { position: "asc" }],
      });

  if (!pipeline) return null;

  const deals = await prisma.deal.findMany({
    where: { ...liveScope(ctx), pipelineId: pipeline.id },
    select: listSelect,
    orderBy: [{ updatedAt: "desc" }],
    take: 500,
  });

  const nextActivities = await prisma.task.groupBy({
    by: ["dealId"],
    where: {
      ...scope(ctx),
      deletedAt: null,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      dealId: { in: deals.map((deal) => deal.id) },
    },
    _min: { dueAt: true },
  });
  const nextByDeal = new Map(nextActivities.map((row) => [row.dealId as string, row._min.dueAt]));

  const byStage = new Map<string, DealListItem[]>();
  for (const deal of deals) {
    const bucket = byStage.get(deal.stage.id) ?? [];
    bucket.push(mapDeal(deal as unknown as DealRow));
    byStage.set(deal.stage.id, bucket);
  }

  return {
    pipeline: { id: pipeline.id, name: pipeline.name },
    stages: pipeline.stages.map((stage) => {
      const stageDeals = byStage.get(stage.id) ?? [];
      return {
        id: stage.id,
        name: stage.name,
        type: stage.type,
        probability: stage.probability,
        position: stage.position,
        totalAmount: stageDeals.reduce((sum, deal) => sum + deal.amount, 0),
        deals: stageDeals.map((deal) => ({
          ...deal,
          nextActivityAt: nextByDeal.get(deal.id)?.toISOString() ?? null,
        })),
      };
    }),
  };
}

export async function getDeal(ctx: ActorContext, id: string) {
  assertPermission(ctx, "deals.read");

  const deal = assertFound(
    await prisma.deal.findFirst({
      where: { id, ...liveScope(ctx) },
      include: {
        company: { select: { id: true, name: true, domain: true } },
        owner: { select: { id: true, name: true, email: true } },
        pipeline: { select: { id: true, name: true, stages: { orderBy: { position: "asc" } } } },
        stage: true,
        contacts: { include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true } } } },
        lineItems: { orderBy: { position: "asc" } },
        tags: { include: { tag: true } },
        propertyValues: true,
        stageHistory: {
          orderBy: { changedAt: "desc" },
          take: 25,
          include: {
            fromStage: { select: { id: true, name: true } },
            toStage: { select: { id: true, name: true } },
            changedBy: { select: { id: true, name: true } },
          },
        },
      },
    }),
    "Der Deal wurde nicht gefunden.",
  );

  const [definitions, openTasks] = await Promise.all([
    listDefinitions(ctx, "DEAL"),
    prisma.task.count({ where: { dealId: id, ...scope(ctx), status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null } }),
  ]);

  return {
    id: deal.id,
    name: deal.name,
    amount: Number(deal.amount),
    currency: deal.currency,
    status: deal.status,
    probability: deal.probability,
    expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
    closedAt: deal.closedAt?.toISOString() ?? null,
    lostReason: deal.lostReason,
    source: deal.source,
    description: deal.description,
    company: deal.company,
    owner: deal.owner,
    pipeline: {
      id: deal.pipeline.id,
      name: deal.pipeline.name,
      stages: deal.pipeline.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        type: stage.type,
        probability: stage.probability,
        position: stage.position,
      })),
    },
    stage: { id: deal.stage.id, name: deal.stage.name, type: deal.stage.type, probability: deal.stage.probability },
    contacts: deal.contacts.map((link) => ({
      id: link.contact.id,
      name: `${link.contact.firstName} ${link.contact.lastName}`.trim(),
      email: link.contact.email,
      jobTitle: link.contact.jobTitle,
      role: link.role,
      isPrimary: link.isPrimary,
    })),
    lineItems: deal.lineItems.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      total: Number(item.quantity) * Number(item.unitPrice),
    })),
    tags: deal.tags.map((link) => ({ id: link.tag.id, name: link.tag.name, color: link.tag.color })),
    stageHistory: deal.stageHistory.map((entry) => ({
      id: entry.id,
      from: entry.fromStage,
      to: entry.toStage,
      changedBy: entry.changedBy,
      changedAt: entry.changedAt.toISOString(),
      durationSeconds: entry.durationSeconds,
    })),
    properties: readValues(definitions, deal.propertyValues),
    propertyDefinitions: definitions,
    openTasks,
    lastActivityAt: deal.lastActivityAt?.toISOString() ?? null,
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
  };
}

export type DealDetail = Awaited<ReturnType<typeof getDeal>>;

async function loadStage(ctx: ActorContext, pipelineId: string, stageId: string) {
  const stage = await prisma.pipelineStage.findFirst({ where: { id: stageId, pipelineId, ...scope(ctx) } });
  if (!stage) throw ValidationError("Die gewählte Stage gehört nicht zur gewählten Pipeline.");
  return stage;
}

export async function createDeal(ctx: ActorContext, input: z.input<typeof dealInputSchema>) {
  assertPermission(ctx, "deals.write");
  const data = dealInputSchema.parse(input);

  await assertRelationsExist(ctx, { companyId: data.companyId, pipelineId: data.pipelineId });
  await assertOwnerInOrganization(ctx, data.ownerId);
  await assertRequiredProperties(ctx, "DEAL", data.properties ?? {});
  const stage = await loadStage(ctx, data.pipelineId, data.stageId);

  if (data.contactIds?.length) {
    const found = await prisma.contact.count({ where: { id: { in: data.contactIds }, ...liveScope(ctx) } });
    if (found !== new Set(data.contactIds).size) {
      throw ValidationError("Mindestens ein Kontakt gehört nicht zu dieser Organisation.");
    }
  }

  const deal = await prisma.deal.create({
    data: {
      organizationId: ctx.organizationId,
      name: data.name,
      pipelineId: data.pipelineId,
      stageId: stage.id,
      amount: data.amount,
      currency: data.currency,
      probability: data.probability ?? stage.probability,
      status: stage.type === "WON" ? "WON" : stage.type === "LOST" ? "LOST" : "OPEN",
      closedAt: stage.type === "OPEN" ? null : new Date(),
      expectedCloseDate: data.expectedCloseDate,
      companyId: data.companyId,
      source: data.source,
      description: data.description,
      ownerId: data.ownerId ?? ctx.userId,
      contacts: data.contactIds?.length
        ? {
            create: data.contactIds.map((contactId, index) => ({
              contactId,
              organizationId: ctx.organizationId,
              isPrimary: index === 0,
            })),
          }
        : undefined,
      stageHistory: {
        create: { organizationId: ctx.organizationId, toStageId: stage.id, changedById: ctx.userId },
      },
    },
  });

  if (data.properties) await writeValues(ctx, "DEAL", deal.id, data.properties);
  if (data.tagIds) await syncTags(ctx, "DEAL", deal.id, data.tagIds);

  await logSystemActivity(ctx, {
    subject: `Deal erstellt: ${deal.name}`,
    links: { dealId: deal.id, companyId: deal.companyId, contactId: data.contactIds?.[0] ?? null },
    metadata: { amount: Number(deal.amount), stage: stage.name },
  });
  await writeAudit(ctx, {
    action: "deal.created",
    entityType: "Deal",
    entityId: deal.id,
    after: { name: deal.name, amount: Number(deal.amount), stage: stage.name },
  });
  await emitDomainEvent(ctx, {
    name: "deal.created",
    entityType: "DEAL",
    entityId: deal.id,
    payload: { id: deal.id, name: deal.name, amount: Number(deal.amount), stage: stage.name },
  });

  if (deal.ownerId && deal.ownerId !== ctx.userId) {
    await notify(ctx, {
      userId: deal.ownerId,
      type: "DEAL_ASSIGNED",
      title: `Neuer Deal: ${deal.name}`,
      body: `${ctx.name} hat dir einen Deal zugewiesen.`,
      link: `/deals/${deal.id}`,
      entityType: "Deal",
      entityId: deal.id,
    });
  }

  return getDeal(ctx, deal.id);
}

export async function updateDeal(
  ctx: ActorContext,
  id: string,
  input: z.input<typeof dealUpdateSchema>,
  options: { depth?: number } = {},
) {
  assertPermission(ctx, "deals.write");
  const data = dealUpdateSchema.parse(input);

  const existing = assertFound(
    await prisma.deal.findFirst({ where: { id, ...liveScope(ctx) } }),
    "Der Deal wurde nicht gefunden.",
  );

  await assertRelationsExist(ctx, { companyId: data.companyId });
  await assertOwnerInOrganization(ctx, data.ownerId);

  const { properties, tagIds, contactIds, stageId, pipelineId, ...fields } = data;

  // A stage change has its own path (history, won/lost handling).
  if (stageId && stageId !== existing.stageId) {
    await changeDealStage(ctx, id, { stageId, lostReason: data.lostReason }, { depth: options.depth });
  }

  const updated = await prisma.deal.update({ where: { id: existing.id }, data: fields });

  if (properties) await writeValues(ctx, "DEAL", id, properties);
  if (tagIds) await syncTags(ctx, "DEAL", id, tagIds);
  if (contactIds) await syncDealContacts(ctx, id, contactIds);

  const delta = diff(existing as unknown as Record<string, unknown>, fields as Record<string, unknown>);
  if (delta.changed.length > 0) {
    await writeAudit(ctx, {
      action: "deal.updated",
      entityType: "Deal",
      entityId: id,
      before: delta.before,
      after: delta.after,
    });
    if (delta.changed.includes("amount")) {
      await logSystemActivity(ctx, {
        subject: `Dealwert geändert: ${Number(existing.amount)} → ${Number(updated.amount)} ${updated.currency}`,
        links: { dealId: id, companyId: updated.companyId },
        metadata: { before: Number(existing.amount), after: Number(updated.amount) },
      });
    }
  }

  await emitDomainEvent(ctx, {
    name: "deal.updated",
    entityType: "DEAL",
    entityId: id,
    payload: { id, name: updated.name, amount: Number(updated.amount) },
    changed: [...delta.changed, ...Object.keys(properties ?? {}).map((key) => `property:${key}`)],
    depth: options.depth,
  });

  return getDeal(ctx, id);
}

/**
 * Moves a deal to another stage: records history with the time spent in the
 * previous stage, keeps won/lost status in sync and emits the matching events.
 */
export async function changeDealStage(
  ctx: ActorContext,
  id: string,
  input: z.input<typeof dealStageChangeSchema>,
  options: { depth?: number } = {},
) {
  assertPermission(ctx, "deals.write");
  const data = dealStageChangeSchema.parse(input);

  const deal = assertFound(
    await prisma.deal.findFirst({
      where: { id, ...liveScope(ctx) },
      include: { stage: true },
    }),
    "Der Deal wurde nicht gefunden.",
  );

  if (deal.stageId === data.stageId) return getDeal(ctx, id);

  const target = await loadStage(ctx, deal.pipelineId, data.stageId);
  const lastChange = await prisma.dealStageHistory.findFirst({
    where: { dealId: deal.id, ...scope(ctx) },
    orderBy: { changedAt: "desc" },
    select: { changedAt: true },
  });
  const since = lastChange?.changedAt ?? deal.createdAt;
  const durationSeconds = Math.max(0, Math.round((Date.now() - since.getTime()) / 1000));

  const status = target.type === "WON" ? "WON" : target.type === "LOST" ? "LOST" : "OPEN";

  await prisma.$transaction([
    prisma.deal.update({
      where: { id: deal.id },
      data: {
        stageId: target.id,
        status,
        probability: target.type === "WON" ? 100 : target.type === "LOST" ? 0 : target.probability,
        closedAt: status === "OPEN" ? null : new Date(),
        lostReason: status === "LOST" ? (data.lostReason ?? deal.lostReason) : null,
      },
    }),
    prisma.dealStageHistory.create({
      data: {
        organizationId: ctx.organizationId,
        dealId: deal.id,
        fromStageId: deal.stageId,
        toStageId: target.id,
        changedById: ctx.userId,
        durationSeconds,
      },
    }),
  ]);

  await logSystemActivity(ctx, {
    subject: `Stage geändert: ${deal.stage.name} → ${target.name}`,
    links: { dealId: deal.id, companyId: deal.companyId },
    metadata: { from: deal.stage.name, to: target.name, durationSeconds },
  });
  await writeAudit(ctx, {
    action: "deal.stage_changed",
    entityType: "Deal",
    entityId: deal.id,
    before: { stage: deal.stage.name, status: deal.status },
    after: { stage: target.name, status },
  });

  const events: DomainEventName[] = ["deal.stage_changed"];
  if (status === "WON") events.push("deal.won");
  if (status === "LOST") events.push("deal.lost");

  for (const name of events) {
    await emitDomainEvent(ctx, {
      name,
      entityType: "DEAL",
      entityId: deal.id,
      payload: {
        id: deal.id,
        name: deal.name,
        amount: Number(deal.amount),
        // Both the ids (workflow triggers match on these) and the names
        // (webhook consumers read these) are part of the payload.
        fromStageId: deal.stageId,
        toStageId: target.id,
        fromStage: deal.stage.name,
        toStage: target.name,
        status,
      },
      changed: ["stageId", "status"],
      depth: options.depth,
    });
  }

  return getDeal(ctx, id);
}

export async function deleteDeal(ctx: ActorContext, id: string) {
  assertPermission(ctx, "deals.delete");
  const existing = assertFound(
    await prisma.deal.findFirst({ where: { id, ...liveScope(ctx) } }),
    "Der Deal wurde nicht gefunden.",
  );
  await prisma.deal.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  await writeAudit(ctx, {
    action: "deal.deleted",
    entityType: "Deal",
    entityId: id,
    before: { name: existing.name, amount: Number(existing.amount) },
  });
  await emitDomainEvent(ctx, {
    name: "deal.deleted",
    entityType: "DEAL",
    entityId: id,
    payload: { id, name: existing.name },
  });
}

async function syncDealContacts(ctx: ActorContext, dealId: string, contactIds: string[]) {
  const unique = Array.from(new Set(contactIds));
  if (unique.length > 0) {
    const found = await prisma.contact.count({ where: { id: { in: unique }, ...liveScope(ctx) } });
    if (found !== unique.length) throw ValidationError("Mindestens ein Kontakt gehört nicht zu dieser Organisation.");
  }
  await prisma.dealContact.deleteMany({ where: { dealId, organizationId: ctx.organizationId } });
  if (unique.length > 0) {
    await prisma.dealContact.createMany({
      data: unique.map((contactId, index) => ({
        dealId,
        contactId,
        organizationId: ctx.organizationId,
        isPrimary: index === 0,
      })),
      skipDuplicates: true,
    });
  }
}
