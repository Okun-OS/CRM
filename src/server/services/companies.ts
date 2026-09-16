import type { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { liveScope, scope, assertFound } from "@/lib/tenant";
import { paginate } from "@/lib/api/pagination";
import { writeAudit, diff } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { readValues } from "@/lib/properties";
import { listDefinitions, writeValues, assertRequiredProperties } from "@/server/services/property-store";
import { companyInputSchema, companyUpdateSchema } from "@/lib/schemas/crm";
import { buildListArgs, type ListQuery } from "./listing";
import { logSystemActivity } from "./activities";
import { assertOwnerInOrganization, syncTags } from "./record-helpers";

/** Companies — the account context around contacts and deals. */
export type CompanyListItem = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenue: number | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  country: string | null;
  lifecycleStage: string | null;
  owner: { id: string; name: string } | null;
  contactCount: number;
  openDeals: number;
  lastActivityAt: string | null;
  createdAt: string;
  properties: Record<string, unknown>;
};

const listSelect = {
  id: true,
  name: true,
  domain: true,
  industry: true,
  employeeCount: true,
  annualRevenue: true,
  phone: true,
  email: true,
  website: true,
  city: true,
  country: true,
  postalCode: true,
  street: true,
  source: true,
  lifecycleStage: true,
  lastActivityAt: true,
  createdAt: true,
  owner: { select: { id: true, name: true } },
  _count: { select: { contacts: true } },
} as const;

export async function listCompanies(ctx: ActorContext, query: ListQuery) {
  assertPermission(ctx, "companies.read");
  const args = await buildListArgs(ctx, "COMPANY", query);

  const [rows, total] = await Promise.all([
    prisma.company.findMany({
      where: args.where as never,
      select: listSelect,
      orderBy: args.orderBy as never,
      skip: args.skip,
      take: args.take,
    }),
    prisma.company.count({ where: args.where as never }),
  ]);

  const ids = rows.map((row) => row.id);
  const [dealCounts, propertyValues, definitions] = await Promise.all([
    ids.length
      ? prisma.deal.groupBy({
          by: ["companyId"],
          where: { companyId: { in: ids }, organizationId: ctx.organizationId, status: "OPEN", deletedAt: null },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.propertyValue.findMany({
          where: { organizationId: ctx.organizationId, objectType: "COMPANY", companyId: { in: ids } },
        })
      : Promise.resolve([]),
    listDefinitions(ctx, "COMPANY"),
  ]);

  const openDealsByCompany = new Map(dealCounts.map((row) => [row.companyId as string, row._count._all]));
  const valuesByCompany = new Map<string, typeof propertyValues>();
  for (const value of propertyValues) {
    if (!value.companyId) continue;
    const bucket = valuesByCompany.get(value.companyId) ?? [];
    bucket.push(value);
    valuesByCompany.set(value.companyId, bucket);
  }

  const items: CompanyListItem[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    employeeCount: row.employeeCount,
    annualRevenue: row.annualRevenue === null ? null : Number(row.annualRevenue),
    phone: row.phone,
    email: row.email,
    city: row.city,
    country: row.country,
    lifecycleStage: row.lifecycleStage,
    owner: row.owner,
    contactCount: row._count.contacts,
    openDeals: openDealsByCompany.get(row.id) ?? 0,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    properties: readValues(definitions, valuesByCompany.get(row.id) ?? []),
  }));

  return paginate(items, total, args.pagination);
}

export async function getCompany(ctx: ActorContext, id: string) {
  assertPermission(ctx, "companies.read");

  const company = assertFound(
    await prisma.company.findFirst({
      where: { id, ...liveScope(ctx) },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        tags: { include: { tag: true } },
        propertyValues: true,
      },
    }),
    "Das Unternehmen wurde nicht gefunden.",
  );

  const [definitions, contacts, deals, openTasks] = await Promise.all([
    listDefinitions(ctx, "COMPANY"),
    prisma.contact.findMany({
      where: { companyId: id, ...liveScope(ctx) },
      select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, phone: true },
      orderBy: { lastName: "asc" },
      take: 50,
    }),
    prisma.deal.findMany({
      where: { companyId: id, ...liveScope(ctx) },
      select: {
        id: true,
        name: true,
        amount: true,
        currency: true,
        status: true,
        expectedCloseDate: true,
        stage: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.task.count({ where: { companyId: id, ...scope(ctx), status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null } }),
  ]);

  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    industry: company.industry,
    employeeCount: company.employeeCount,
    annualRevenue: company.annualRevenue === null ? null : Number(company.annualRevenue),
    phone: company.phone,
    email: company.email,
    website: company.website,
    street: company.street,
    postalCode: company.postalCode,
    city: company.city,
    country: company.country,
    lifecycleStage: company.lifecycleStage,
    source: company.source,
    description: company.description,
    owner: company.owner,
    createdBy: company.createdBy,
    tags: company.tags.map((link) => ({ id: link.tag.id, name: link.tag.name, color: link.tag.color })),
    lastActivityAt: company.lastActivityAt?.toISOString() ?? null,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
    properties: readValues(definitions, company.propertyValues),
    propertyDefinitions: definitions,
    contacts: contacts.map((contact) => ({
      id: contact.id,
      name: `${contact.firstName} ${contact.lastName}`.trim(),
      email: contact.email,
      phone: contact.phone,
      jobTitle: contact.jobTitle,
    })),
    deals: deals.map((deal) => ({
      id: deal.id,
      name: deal.name,
      amount: Number(deal.amount),
      currency: deal.currency,
      status: deal.status,
      expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
      stage: deal.stage,
    })),
    openTasks,
  };
}

export type CompanyDetail = Awaited<ReturnType<typeof getCompany>>;

export async function createCompany(ctx: ActorContext, input: z.input<typeof companyInputSchema>) {
  assertPermission(ctx, "companies.write");
  const data = companyInputSchema.parse(input);
  await assertOwnerInOrganization(ctx, data.ownerId);
  await assertRequiredProperties(ctx, "COMPANY", data.properties ?? {});

  const company = await prisma.company.create({
    data: {
      organizationId: ctx.organizationId,
      name: data.name,
      domain: normaliseDomain(data.domain),
      industry: data.industry,
      employeeCount: data.employeeCount,
      annualRevenue: data.annualRevenue,
      phone: data.phone,
      email: data.email,
      website: data.website,
      street: data.street,
      postalCode: data.postalCode,
      city: data.city,
      country: data.country,
      lifecycleStage: data.lifecycleStage ?? "lead",
      source: data.source,
      description: data.description,
      ownerId: data.ownerId ?? ctx.userId,
      createdById: ctx.userId,
    },
  });

  if (data.properties) await writeValues(ctx, "COMPANY", company.id, data.properties);
  if (data.tagIds) await syncTags(ctx, "COMPANY", company.id, data.tagIds);

  await logSystemActivity(ctx, {
    subject: "Unternehmen erstellt",
    links: { companyId: company.id },
    metadata: { event: "company.created" },
  });
  await writeAudit(ctx, {
    action: "company.created",
    entityType: "Company",
    entityId: company.id,
    after: { name: company.name, domain: company.domain },
  });
  await emitDomainEvent(ctx, {
    name: "company.created",
    entityType: "COMPANY",
    entityId: company.id,
    payload: { id: company.id, name: company.name, domain: company.domain },
  });

  return getCompany(ctx, company.id);
}

export async function updateCompany(
  ctx: ActorContext,
  id: string,
  input: z.input<typeof companyUpdateSchema>,
  options: { depth?: number } = {},
) {
  assertPermission(ctx, "companies.write");
  const data = companyUpdateSchema.parse(input);
  const existing = assertFound(
    await prisma.company.findFirst({ where: { id, ...liveScope(ctx) } }),
    "Das Unternehmen wurde nicht gefunden.",
  );
  await assertOwnerInOrganization(ctx, data.ownerId);

  const { properties, tagIds, ...fields } = data;
  if (fields.domain !== undefined) fields.domain = normaliseDomain(fields.domain);

  const updated = await prisma.company.update({ where: { id: existing.id }, data: fields });
  if (properties) await writeValues(ctx, "COMPANY", id, properties);
  if (tagIds) await syncTags(ctx, "COMPANY", id, tagIds);

  const delta = diff(existing as unknown as Record<string, unknown>, fields as Record<string, unknown>);
  if (delta.changed.length > 0) {
    await writeAudit(ctx, {
      action: "company.updated",
      entityType: "Company",
      entityId: id,
      before: delta.before,
      after: delta.after,
    });
    await logSystemActivity(ctx, {
      subject: `Unternehmen aktualisiert: ${delta.changed.join(", ")}`,
      links: { companyId: id },
      metadata: { changed: delta.changed },
    });
  }

  await emitDomainEvent(ctx, {
    name: "company.updated",
    entityType: "COMPANY",
    entityId: id,
    payload: { id, name: updated.name },
    changed: [...delta.changed, ...Object.keys(properties ?? {}).map((key) => `property:${key}`)],
    depth: options.depth,
  });

  return getCompany(ctx, id);
}

export async function deleteCompany(ctx: ActorContext, id: string) {
  assertPermission(ctx, "companies.delete");
  const existing = assertFound(
    await prisma.company.findFirst({ where: { id, ...liveScope(ctx) } }),
    "Das Unternehmen wurde nicht gefunden.",
  );
  await prisma.company.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });

  await writeAudit(ctx, {
    action: "company.deleted",
    entityType: "Company",
    entityId: id,
    before: { name: existing.name, domain: existing.domain },
  });
  await emitDomainEvent(ctx, {
    name: "company.deleted",
    entityType: "COMPANY",
    entityId: id,
    payload: { id, name: existing.name },
  });
}

/** Stores domains comparably (no scheme, no www, lower-case) for duplicate detection. */
export function normaliseDomain(input?: string | null): string | undefined {
  if (!input) return undefined;
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}
