import type { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { liveScope, scope, assertFound } from "@/lib/tenant";
import { paginate } from "@/lib/api/pagination";
import { writeAudit, diff } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { readValues } from "@/lib/properties";
import { listDefinitions, writeValues, assertRequiredProperties } from "@/server/services/property-store";
import { contactInputSchema, contactUpdateSchema } from "@/lib/schemas/crm";
import { buildListArgs, type ListQuery } from "./listing";
import { logSystemActivity } from "./activities";
import { assertOwnerInOrganization, assertRelationsExist, syncTags } from "./record-helpers";

/**
 * Contacts — the central CRM object. Every function is tenant-scoped through
 * `scope(ctx)`/`liveScope(ctx)` and permission-checked before touching data.
 */
export type ContactListItem = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  jobTitle: string | null;
  lifecycleStage: string | null;
  leadStatus: string | null;
  source: string | null;
  city: string | null;
  country: string | null;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  lastActivityAt: string | null;
  nextActivityAt: string | null;
  openDeals: number;
  createdAt: string;
  properties: Record<string, unknown>;
};

const listSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  mobile: true,
  jobTitle: true,
  lifecycleStage: true,
  leadStatus: true,
  source: true,
  city: true,
  country: true,
  street: true,
  postalCode: true,
  linkedinUrl: true,
  lastActivityAt: true,
  nextActivityAt: true,
  createdAt: true,
  company: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
} as const;

export function contactName(contact: { firstName: string; lastName: string }): string {
  return `${contact.firstName} ${contact.lastName}`.trim();
}

export async function listContacts(ctx: ActorContext, query: ListQuery) {
  assertPermission(ctx, "contacts.read");
  const args = await buildListArgs(ctx, "CONTACT", query);

  const [rows, total] = await Promise.all([
    prisma.contact.findMany({
      where: args.where as never,
      select: listSelect,
      orderBy: args.orderBy as never,
      skip: args.skip,
      take: args.take,
    }),
    prisma.contact.count({ where: args.where as never }),
  ]);

  const ids = rows.map((row) => row.id);
  const [openDeals, propertyValues, definitions] = await Promise.all([
    ids.length
      ? prisma.dealContact.groupBy({
          by: ["contactId"],
          where: { contactId: { in: ids }, organizationId: ctx.organizationId, deal: { status: "OPEN", deletedAt: null } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.propertyValue.findMany({
          where: { organizationId: ctx.organizationId, objectType: "CONTACT", contactId: { in: ids } },
        })
      : Promise.resolve([]),
    listDefinitions(ctx, "CONTACT"),
  ]);

  const dealCounts = new Map(openDeals.map((row) => [row.contactId as string, row._count._all]));
  const valuesByContact = new Map<string, typeof propertyValues>();
  for (const value of propertyValues) {
    if (!value.contactId) continue;
    const bucket = valuesByContact.get(value.contactId) ?? [];
    bucket.push(value);
    valuesByContact.set(value.contactId, bucket);
  }

  const items: ContactListItem[] = rows.map((row) => ({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    name: contactName(row),
    email: row.email,
    phone: row.phone,
    mobile: row.mobile,
    jobTitle: row.jobTitle,
    lifecycleStage: row.lifecycleStage,
    leadStatus: row.leadStatus,
    source: row.source,
    city: row.city,
    country: row.country,
    company: row.company,
    owner: row.owner,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    nextActivityAt: row.nextActivityAt?.toISOString() ?? null,
    openDeals: dealCounts.get(row.id) ?? 0,
    createdAt: row.createdAt.toISOString(),
    properties: readValues(definitions, valuesByContact.get(row.id) ?? []),
  }));

  return paginate(items, total, args.pagination);
}

export async function getContact(ctx: ActorContext, id: string) {
  assertPermission(ctx, "contacts.read");

  const contact = assertFound(
    await prisma.contact.findFirst({
      where: { id, ...liveScope(ctx) },
      include: {
        company: { select: { id: true, name: true, domain: true, industry: true } },
        owner: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        tags: { include: { tag: true } },
        propertyValues: true,
      },
    }),
    "Der Kontakt wurde nicht gefunden.",
  );

  const [definitions, deals, openTasks, upcomingMeeting] = await Promise.all([
    listDefinitions(ctx, "CONTACT"),
    prisma.dealContact.findMany({
      where: { contactId: id, organizationId: ctx.organizationId, deal: { deletedAt: null } },
      select: {
        deal: {
          select: {
            id: true,
            name: true,
            amount: true,
            currency: true,
            status: true,
            stage: { select: { id: true, name: true, type: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.task.count({ where: { contactId: id, ...scope(ctx), status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null } }),
    prisma.meeting.findFirst({
      where: { contactId: id, ...scope(ctx), deletedAt: null, startAt: { gte: new Date() } },
      orderBy: { startAt: "asc" },
      select: { id: true, title: true, startAt: true },
    }),
  ]);

  return {
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    name: contactName(contact),
    email: contact.email,
    phone: contact.phone,
    mobile: contact.mobile,
    jobTitle: contact.jobTitle,
    lifecycleStage: contact.lifecycleStage,
    leadStatus: contact.leadStatus,
    source: contact.source,
    street: contact.street,
    postalCode: contact.postalCode,
    city: contact.city,
    country: contact.country,
    linkedinUrl: contact.linkedinUrl,
    description: contact.description,
    company: contact.company,
    owner: contact.owner,
    createdBy: contact.createdBy,
    tags: contact.tags.map((link) => ({ id: link.tag.id, name: link.tag.name, color: link.tag.color })),
    lastActivityAt: contact.lastActivityAt?.toISOString() ?? null,
    nextActivityAt: contact.nextActivityAt?.toISOString() ?? null,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
    properties: readValues(definitions, contact.propertyValues),
    propertyDefinitions: definitions,
    deals: deals.map((link) => ({
      id: link.deal.id,
      name: link.deal.name,
      amount: Number(link.deal.amount),
      currency: link.deal.currency,
      status: link.deal.status,
      stage: link.deal.stage,
    })),
    openTasks,
    upcomingMeeting: upcomingMeeting
      ? { id: upcomingMeeting.id, title: upcomingMeeting.title, startAt: upcomingMeeting.startAt.toISOString() }
      : null,
  };
}

export type ContactDetail = Awaited<ReturnType<typeof getContact>>;

export async function createContact(ctx: ActorContext, input: z.input<typeof contactInputSchema>) {
  assertPermission(ctx, "contacts.write");
  const data = contactInputSchema.parse(input);

  await assertRelationsExist(ctx, { companyId: data.companyId });
  await assertOwnerInOrganization(ctx, data.ownerId);
  await assertRequiredProperties(ctx, "CONTACT", data.properties ?? {});

  const contact = await prisma.contact.create({
    data: {
      organizationId: ctx.organizationId,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      mobile: data.mobile,
      jobTitle: data.jobTitle,
      companyId: data.companyId,
      lifecycleStage: data.lifecycleStage ?? "lead",
      leadStatus: data.leadStatus,
      source: data.source,
      street: data.street,
      postalCode: data.postalCode,
      city: data.city,
      country: data.country,
      linkedinUrl: data.linkedinUrl,
      description: data.description,
      ownerId: data.ownerId ?? ctx.userId,
      createdById: ctx.userId,
    },
  });

  if (data.properties) await writeValues(ctx, "CONTACT", contact.id, data.properties);
  if (data.tagIds) await syncTags(ctx, "CONTACT", contact.id, data.tagIds);

  await logSystemActivity(ctx, {
    subject: "Kontakt erstellt",
    links: { contactId: contact.id, companyId: contact.companyId },
    metadata: { event: "contact.created" },
  });
  await writeAudit(ctx, {
    action: "contact.created",
    entityType: "Contact",
    entityId: contact.id,
    after: { name: contactName(contact), email: contact.email },
  });
  await emitDomainEvent(ctx, {
    name: "contact.created",
    entityType: "CONTACT",
    entityId: contact.id,
    payload: { id: contact.id, name: contactName(contact), email: contact.email },
  });

  return getContact(ctx, contact.id);
}

export async function updateContact(
  ctx: ActorContext,
  id: string,
  input: z.input<typeof contactUpdateSchema>,
  options: { depth?: number } = {},
) {
  assertPermission(ctx, "contacts.write");
  const data = contactUpdateSchema.parse(input);

  const existing = assertFound(
    await prisma.contact.findFirst({ where: { id, ...liveScope(ctx) } }),
    "Der Kontakt wurde nicht gefunden.",
  );

  await assertRelationsExist(ctx, { companyId: data.companyId });
  await assertOwnerInOrganization(ctx, data.ownerId);

  const { properties, tagIds, ...fields } = data;
  const updated = await prisma.contact.update({ where: { id: existing.id }, data: fields });

  if (properties) await writeValues(ctx, "CONTACT", id, properties);
  if (tagIds) await syncTags(ctx, "CONTACT", id, tagIds);

  const delta = diff(existing as unknown as Record<string, unknown>, fields as Record<string, unknown>);
  if (delta.changed.length > 0) {
    await writeAudit(ctx, {
      action: "contact.updated",
      entityType: "Contact",
      entityId: id,
      before: delta.before,
      after: delta.after,
    });
    await logSystemActivity(ctx, {
      subject: `Kontakt aktualisiert: ${delta.changed.join(", ")}`,
      links: { contactId: id, companyId: updated.companyId },
      metadata: { changed: delta.changed },
    });
  }

  await emitDomainEvent(ctx, {
    name: "contact.updated",
    entityType: "CONTACT",
    entityId: id,
    payload: { id, name: contactName(updated), email: updated.email },
    changed: [...delta.changed, ...Object.keys(properties ?? {}).map((key) => `property:${key}`)],
    depth: options.depth,
  });

  return getContact(ctx, id);
}

/** Soft delete — the record stays recoverable and auditable. */
export async function deleteContact(ctx: ActorContext, id: string) {
  assertPermission(ctx, "contacts.delete");
  const existing = assertFound(
    await prisma.contact.findFirst({ where: { id, ...liveScope(ctx) } }),
    "Der Kontakt wurde nicht gefunden.",
  );

  await prisma.contact.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });

  await writeAudit(ctx, {
    action: "contact.deleted",
    entityType: "Contact",
    entityId: id,
    before: { name: contactName(existing), email: existing.email },
  });
  await emitDomainEvent(ctx, {
    name: "contact.deleted",
    entityType: "CONTACT",
    entityId: id,
    payload: { id, name: contactName(existing) },
  });
}

/** Permanent removal, used by the data-protection erasure flow. */
export async function purgeContact(ctx: ActorContext, id: string) {
  assertPermission(ctx, "contacts.delete");
  assertPermission(ctx, "settings.manage");
  const existing = assertFound(
    await prisma.contact.findFirst({ where: { id, ...scope(ctx) } }),
    "Der Kontakt wurde nicht gefunden.",
  );
  await prisma.contact.delete({ where: { id: existing.id } });
  await writeAudit(ctx, {
    action: "contact.purged",
    entityType: "Contact",
    entityId: id,
    before: { name: contactName(existing), email: existing.email },
  });
}
