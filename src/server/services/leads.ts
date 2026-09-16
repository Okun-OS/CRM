import type { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { liveScope, scope, assertFound } from "@/lib/tenant";
import { paginate } from "@/lib/api/pagination";
import { writeAudit, diff } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { readValues } from "@/lib/properties";
import { listDefinitions, writeValues, assertRequiredProperties } from "@/server/services/property-store";
import { leadInputSchema, leadUpdateSchema } from "@/lib/schemas/crm";
import { Conflict, ValidationError } from "@/lib/api/errors";
import { buildListArgs, type ListQuery } from "./listing";
import { logSystemActivity } from "./activities";
import { assertOwnerInOrganization, assertRelationsExist } from "./record-helpers";
import { createContact } from "./contacts";
import { createCompany } from "./companies";
import { createDeal } from "./deals";
import { getDefaultPipeline } from "./pipelines";

/**
 * Leads are a distinct object with their own qualification lifecycle — not a
 * contact with a different label. Conversion creates the contact, company and
 * deal and links them back to the originating lead.
 */
export type LeadListItem = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  status: string;
  source: string | null;
  score: number | null;
  nextStepAt: string | null;
  lastActivityAt: string | null;
  owner: { id: string; name: string } | null;
  convertedAt: string | null;
  createdAt: string;
  properties: Record<string, unknown>;
};

const listSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  companyName: true,
  jobTitle: true,
  status: true,
  source: true,
  score: true,
  nextStepAt: true,
  lastActivityAt: true,
  convertedAt: true,
  createdAt: true,
  owner: { select: { id: true, name: true } },
} as const;

export function leadName(lead: { firstName: string | null; lastName: string | null; companyName: string | null }) {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || lead.companyName || "Unbenannter Lead";
}

export async function listLeads(ctx: ActorContext, query: ListQuery) {
  assertPermission(ctx, "leads.read");
  const args = await buildListArgs(ctx, "LEAD", query);

  const [rows, total] = await Promise.all([
    prisma.lead.findMany({
      where: args.where as never,
      select: listSelect,
      orderBy: args.orderBy as never,
      skip: args.skip,
      take: args.take,
    }),
    prisma.lead.count({ where: args.where as never }),
  ]);

  const ids = rows.map((row) => row.id);
  const [propertyValues, definitions] = await Promise.all([
    ids.length
      ? prisma.propertyValue.findMany({
          where: { organizationId: ctx.organizationId, objectType: "LEAD", leadId: { in: ids } },
        })
      : Promise.resolve([]),
    listDefinitions(ctx, "LEAD"),
  ]);

  const valuesByLead = new Map<string, typeof propertyValues>();
  for (const value of propertyValues) {
    if (!value.leadId) continue;
    const bucket = valuesByLead.get(value.leadId) ?? [];
    bucket.push(value);
    valuesByLead.set(value.leadId, bucket);
  }

  const items: LeadListItem[] = rows.map((row) => ({
    id: row.id,
    name: leadName(row),
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    companyName: row.companyName,
    jobTitle: row.jobTitle,
    status: row.status,
    source: row.source,
    score: row.score,
    nextStepAt: row.nextStepAt?.toISOString() ?? null,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    owner: row.owner,
    convertedAt: row.convertedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    properties: readValues(definitions, valuesByLead.get(row.id) ?? []),
  }));

  return paginate(items, total, args.pagination);
}

export async function getLead(ctx: ActorContext, id: string) {
  assertPermission(ctx, "leads.read");
  const lead = assertFound(
    await prisma.lead.findFirst({
      where: { id, ...liveScope(ctx) },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
        propertyValues: true,
      },
    }),
    "Der Lead wurde nicht gefunden.",
  );

  const [definitions, openTasks] = await Promise.all([
    listDefinitions(ctx, "LEAD"),
    prisma.task.count({ where: { leadId: id, ...scope(ctx), status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null } }),
  ]);

  return {
    id: lead.id,
    name: leadName(lead),
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    companyName: lead.companyName,
    jobTitle: lead.jobTitle,
    status: lead.status,
    source: lead.source,
    score: lead.score,
    qualification: lead.qualification,
    nextStepAt: lead.nextStepAt?.toISOString() ?? null,
    lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
    owner: lead.owner,
    contact: lead.contact ? { id: lead.contact.id, name: `${lead.contact.firstName} ${lead.contact.lastName}`.trim() } : null,
    company: lead.company,
    convertedAt: lead.convertedAt?.toISOString() ?? null,
    convertedContactId: lead.convertedContactId,
    convertedCompanyId: lead.convertedCompanyId,
    convertedDealId: lead.convertedDealId,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    properties: readValues(definitions, lead.propertyValues),
    propertyDefinitions: definitions,
    openTasks,
  };
}

export type LeadDetail = Awaited<ReturnType<typeof getLead>>;

async function assertStatusExists(ctx: ActorContext, status: string) {
  const option = await prisma.leadStatusOption.findFirst({ where: { ...scope(ctx), key: status } });
  if (!option) throw ValidationError(`"${status}" ist kein konfigurierter Lead-Status.`);
  return option;
}

export async function createLead(ctx: ActorContext, input: z.input<typeof leadInputSchema>) {
  assertPermission(ctx, "leads.write");
  const data = leadInputSchema.parse(input);

  await assertStatusExists(ctx, data.status);
  await assertRelationsExist(ctx, { contactId: data.contactId, companyId: data.companyId });
  await assertOwnerInOrganization(ctx, data.ownerId);
  await assertRequiredProperties(ctx, "LEAD", data.properties ?? {});

  if (!data.email && !data.phone && !data.lastName && !data.companyName) {
    throw ValidationError("Ein Lead braucht mindestens einen Namen, ein Unternehmen, eine E-Mail oder eine Telefonnummer.");
  }

  const lead = await prisma.lead.create({
    data: {
      organizationId: ctx.organizationId,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      companyName: data.companyName,
      jobTitle: data.jobTitle,
      source: data.source,
      status: data.status,
      score: data.score,
      qualification: data.qualification,
      nextStepAt: data.nextStepAt,
      ownerId: data.ownerId ?? ctx.userId,
      contactId: data.contactId,
      companyId: data.companyId,
    },
  });

  if (data.properties) await writeValues(ctx, "LEAD", lead.id, data.properties);

  await logSystemActivity(ctx, {
    subject: "Lead erstellt",
    links: { leadId: lead.id, contactId: lead.contactId, companyId: lead.companyId },
    metadata: { status: lead.status, source: lead.source },
  });
  await writeAudit(ctx, {
    action: "lead.created",
    entityType: "Lead",
    entityId: lead.id,
    after: { name: leadName(lead), status: lead.status },
  });
  await emitDomainEvent(ctx, {
    name: "lead.created",
    entityType: "LEAD",
    entityId: lead.id,
    payload: { id: lead.id, name: leadName(lead), status: lead.status },
  });

  return getLead(ctx, lead.id);
}

export async function updateLead(
  ctx: ActorContext,
  id: string,
  input: z.input<typeof leadUpdateSchema>,
  options: { depth?: number } = {},
) {
  assertPermission(ctx, "leads.write");
  const data = leadUpdateSchema.parse(input);

  const existing = assertFound(
    await prisma.lead.findFirst({ where: { id, ...liveScope(ctx) } }),
    "Der Lead wurde nicht gefunden.",
  );
  if (existing.convertedAt) throw Conflict("Ein konvertierter Lead kann nicht mehr bearbeitet werden.");

  if (data.status) await assertStatusExists(ctx, data.status);
  await assertRelationsExist(ctx, { contactId: data.contactId, companyId: data.companyId });
  await assertOwnerInOrganization(ctx, data.ownerId);

  const { properties, ...fields } = data;
  const updated = await prisma.lead.update({ where: { id: existing.id }, data: fields });
  if (properties) await writeValues(ctx, "LEAD", id, properties);

  const delta = diff(existing as unknown as Record<string, unknown>, fields as Record<string, unknown>);
  const statusChanged = delta.changed.includes("status");

  if (delta.changed.length > 0) {
    await writeAudit(ctx, {
      action: statusChanged ? "lead.status_changed" : "lead.updated",
      entityType: "Lead",
      entityId: id,
      before: delta.before,
      after: delta.after,
    });
  }
  if (statusChanged) {
    await logSystemActivity(ctx, {
      subject: `Lead-Status geändert: ${existing.status} → ${updated.status}`,
      links: { leadId: id, contactId: updated.contactId, companyId: updated.companyId },
      metadata: { from: existing.status, to: updated.status },
    });
  }

  await emitDomainEvent(ctx, {
    name: statusChanged ? "lead.status_changed" : "lead.updated",
    entityType: "LEAD",
    entityId: id,
    payload: { id, name: leadName(updated), status: updated.status, previousStatus: existing.status },
    changed: [...delta.changed, ...Object.keys(properties ?? {}).map((key) => `property:${key}`)],
    depth: options.depth,
  });

  return getLead(ctx, id);
}

export async function deleteLead(ctx: ActorContext, id: string) {
  assertPermission(ctx, "leads.delete");
  const existing = assertFound(
    await prisma.lead.findFirst({ where: { id, ...liveScope(ctx) } }),
    "Der Lead wurde nicht gefunden.",
  );
  await prisma.lead.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  await writeAudit(ctx, { action: "lead.deleted", entityType: "Lead", entityId: id, before: { name: leadName(existing) } });
}

export type ConvertLeadInput = {
  createDeal: boolean;
  dealName?: string;
  dealAmount?: number;
  pipelineId?: string;
  stageId?: string;
  companyId?: string;
  contactId?: string;
};

/**
 * Converts a lead into a contact (and optionally a company and a deal).
 * Existing records can be reused instead of creating duplicates.
 */
export async function convertLead(ctx: ActorContext, id: string, input: ConvertLeadInput) {
  assertPermission(ctx, "leads.write");
  assertPermission(ctx, "contacts.write");

  const lead = assertFound(
    await prisma.lead.findFirst({ where: { id, ...liveScope(ctx) } }),
    "Der Lead wurde nicht gefunden.",
  );
  if (lead.convertedAt) throw Conflict("Dieser Lead wurde bereits konvertiert.");

  // Company: reuse an explicitly chosen one, otherwise create from the lead's company name.
  let companyId = input.companyId ?? lead.companyId ?? undefined;
  if (!companyId && lead.companyName) {
    const company = await createCompany(ctx, { name: lead.companyName, source: lead.source ?? undefined });
    companyId = company.id;
  }

  let contactId = input.contactId ?? lead.contactId ?? undefined;
  if (!contactId) {
    const contact = await createContact(ctx, {
      firstName: lead.firstName ?? "Unbekannt",
      lastName: lead.lastName ?? (lead.companyName ?? "Lead"),
      email: lead.email ?? undefined,
      phone: lead.phone ?? undefined,
      jobTitle: lead.jobTitle ?? undefined,
      companyId,
      source: lead.source ?? undefined,
      lifecycleStage: "opportunity",
      ownerId: lead.ownerId ?? undefined,
    });
    contactId = contact.id;
  }

  let dealId: string | undefined;
  if (input.createDeal) {
    assertPermission(ctx, "deals.write");
    const pipeline = input.pipelineId
      ? await prisma.pipeline.findFirst({
          where: { id: input.pipelineId, ...scope(ctx) },
          include: { stages: { orderBy: { position: "asc" } } },
        })
      : await getDefaultPipeline(ctx);
    if (!pipeline || pipeline.stages.length === 0) {
      throw ValidationError("Es ist keine Pipeline konfiguriert, in der der Deal angelegt werden könnte.");
    }
    const stageId = input.stageId ?? pipeline.stages[0].id;
    const deal = await createDeal(ctx, {
      name: input.dealName ?? `${leadName(lead)}${lead.companyName ? ` – ${lead.companyName}` : ""}`,
      pipelineId: pipeline.id,
      stageId,
      amount: input.dealAmount ?? 0,
      companyId,
      contactIds: contactId ? [contactId] : undefined,
      source: lead.source ?? undefined,
      ownerId: lead.ownerId ?? undefined,
    });
    dealId = deal.id;
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      convertedAt: new Date(),
      convertedContactId: contactId,
      convertedCompanyId: companyId,
      convertedDealId: dealId,
      contactId,
      companyId,
      status: await terminalStatusKey(ctx),
    },
  });

  await logSystemActivity(ctx, {
    subject: "Lead konvertiert",
    links: { leadId: lead.id, contactId, companyId, dealId },
    metadata: { contactId, companyId, dealId },
  });
  await writeAudit(ctx, {
    action: "lead.converted",
    entityType: "Lead",
    entityId: lead.id,
    after: { contactId, companyId, dealId },
  });
  await emitDomainEvent(ctx, {
    name: "lead.converted",
    entityType: "LEAD",
    entityId: lead.id,
    payload: { id: lead.id, contactId, companyId, dealId },
  });

  return { leadId: lead.id, contactId, companyId, dealId };
}

/** The configured "converted" status, falling back to the last terminal one. */
async function terminalStatusKey(ctx: ActorContext): Promise<string> {
  const converted = await prisma.leadStatusOption.findFirst({
    where: { ...scope(ctx), OR: [{ key: "converted" }, { isTerminal: true }] },
    orderBy: [{ key: "asc" }],
  });
  return converted?.key ?? "converted";
}
