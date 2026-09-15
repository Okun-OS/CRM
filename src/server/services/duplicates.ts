import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { liveScope, scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { ValidationError } from "@/lib/api/errors";
import { normaliseDomain } from "./companies";
import { logSystemActivity } from "./activities";

/**
 * Duplicate detection and merging.
 *
 * Detection is deliberately conservative — e-mail for contacts, domain or
 * normalised name for companies — and nothing is merged automatically. A merge
 * keeps the primary record's values, fills its empty fields from the duplicate,
 * moves all related data and soft-deletes the duplicate.
 */
export type DuplicateGroup<T> = { reason: string; value: string; records: T[] };

export async function findContactDuplicates(ctx: ActorContext, limit = 50) {
  assertPermission(ctx, "contacts.read");

  const byEmail = await prisma.contact.groupBy({
    by: ["email"],
    where: { ...liveScope(ctx), email: { not: null } },
    _count: { _all: true },
    having: { email: { _count: { gt: 1 } } },
    orderBy: { email: "asc" },
    take: limit,
  });

  const groups: DuplicateGroup<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    createdAt: string;
  }>[] = [];

  for (const group of byEmail) {
    if (!group.email) continue;
    const records = await prisma.contact.findMany({
      where: { ...liveScope(ctx), email: group.email },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        createdAt: true,
        company: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    groups.push({
      reason: "Gleiche E-Mail-Adresse",
      value: group.email,
      records: records.map((record) => ({
        id: record.id,
        name: `${record.firstName} ${record.lastName}`.trim(),
        email: record.email,
        phone: record.phone,
        company: record.company?.name ?? null,
        createdAt: record.createdAt.toISOString(),
      })),
    });
  }

  return groups;
}

export async function findCompanyDuplicates(ctx: ActorContext, limit = 50) {
  assertPermission(ctx, "companies.read");

  const byDomain = await prisma.company.groupBy({
    by: ["domain"],
    where: { ...liveScope(ctx), domain: { not: null } },
    _count: { _all: true },
    having: { domain: { _count: { gt: 1 } } },
    orderBy: { domain: "asc" },
    take: limit,
  });

  const groups: DuplicateGroup<{ id: string; name: string; domain: string | null; createdAt: string }>[] = [];

  for (const group of byDomain) {
    if (!group.domain) continue;
    const records = await prisma.company.findMany({
      where: { ...liveScope(ctx), domain: group.domain },
      select: { id: true, name: true, domain: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    groups.push({
      reason: "Gleiche Domain",
      value: group.domain,
      records: records.map((record) => ({ ...record, createdAt: record.createdAt.toISOString() })),
    });
  }

  return groups;
}

/** Fields copied from the duplicate when the primary record leaves them empty. */
const CONTACT_FILLABLE = [
  "email",
  "phone",
  "mobile",
  "jobTitle",
  "companyId",
  "source",
  "street",
  "postalCode",
  "city",
  "country",
  "linkedinUrl",
  "description",
] as const;

export async function mergeContacts(ctx: ActorContext, primaryId: string, duplicateId: string) {
  assertPermission(ctx, "contacts.write");
  assertPermission(ctx, "contacts.delete");
  if (primaryId === duplicateId) throw ValidationError("Ein Datensatz kann nicht mit sich selbst zusammengeführt werden.");

  const [primary, duplicate] = await Promise.all([
    prisma.contact.findFirst({ where: { id: primaryId, ...liveScope(ctx) } }),
    prisma.contact.findFirst({ where: { id: duplicateId, ...liveScope(ctx) } }),
  ]);
  assertFound(primary, "Der Zielkontakt wurde nicht gefunden.");
  assertFound(duplicate, "Der Duplikatkontakt wurde nicht gefunden.");

  const fill: Record<string, unknown> = {};
  for (const field of CONTACT_FILLABLE) {
    const primaryValue = (primary as unknown as Record<string, unknown>)[field];
    const duplicateValue = (duplicate as unknown as Record<string, unknown>)[field];
    if ((primaryValue === null || primaryValue === undefined || primaryValue === "") && duplicateValue) {
      fill[field] = duplicateValue;
    }
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(fill).length > 0) {
      await tx.contact.update({ where: { id: primaryId }, data: fill });
    }

    // Move everything that references the duplicate.
    await tx.activity.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });
    await tx.task.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });
    await tx.note.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });
    await tx.meeting.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });
    await tx.emailMessage.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });
    await tx.fileObject.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });
    await tx.lead.updateMany({ where: { contactId: duplicateId }, data: { contactId: primaryId } });

    // Deal links: skip the ones the primary already has.
    const duplicateLinks = await tx.dealContact.findMany({ where: { contactId: duplicateId } });
    for (const link of duplicateLinks) {
      const exists = await tx.dealContact.findFirst({ where: { dealId: link.dealId, contactId: primaryId } });
      if (!exists) {
        await tx.dealContact.create({
          data: {
            dealId: link.dealId,
            contactId: primaryId,
            organizationId: link.organizationId,
            role: link.role,
            isPrimary: link.isPrimary,
          },
        });
      }
      await tx.dealContact.delete({ where: { dealId_contactId: { dealId: link.dealId, contactId: duplicateId } } });
    }

    // Custom properties: only where the primary has no value yet.
    const duplicateValues = await tx.propertyValue.findMany({ where: { contactId: duplicateId } });
    for (const value of duplicateValues) {
      const exists = await tx.propertyValue.findFirst({
        where: { definitionId: value.definitionId, contactId: primaryId },
      });
      if (!exists) {
        await tx.propertyValue.update({ where: { id: value.id }, data: { contactId: primaryId } });
      }
    }

    // Tags.
    const duplicateTags = await tx.contactTag.findMany({ where: { contactId: duplicateId } });
    for (const tag of duplicateTags) {
      const exists = await tx.contactTag.findFirst({ where: { contactId: primaryId, tagId: tag.tagId } });
      if (!exists) await tx.contactTag.create({ data: { contactId: primaryId, tagId: tag.tagId } });
    }

    await tx.contact.update({ where: { id: duplicateId }, data: { deletedAt: new Date() } });
  });

  await logSystemActivity(ctx, {
    subject: "Kontakte zusammengeführt",
    links: { contactId: primaryId },
    metadata: { mergedFrom: duplicateId, filledFields: Object.keys(fill) },
  });
  await writeAudit(ctx, {
    action: "contact.merged",
    entityType: "Contact",
    entityId: primaryId,
    before: { duplicateId, duplicateName: `${duplicate!.firstName} ${duplicate!.lastName}`.trim() },
    after: { filledFields: Object.keys(fill) },
  });

  return { primaryId, mergedFields: Object.keys(fill) };
}

export async function mergeCompanies(ctx: ActorContext, primaryId: string, duplicateId: string) {
  assertPermission(ctx, "companies.write");
  assertPermission(ctx, "companies.delete");
  if (primaryId === duplicateId) throw ValidationError("Ein Datensatz kann nicht mit sich selbst zusammengeführt werden.");

  const [primary, duplicate] = await Promise.all([
    prisma.company.findFirst({ where: { id: primaryId, ...liveScope(ctx) } }),
    prisma.company.findFirst({ where: { id: duplicateId, ...liveScope(ctx) } }),
  ]);
  assertFound(primary, "Das Zielunternehmen wurde nicht gefunden.");
  assertFound(duplicate, "Das Duplikat wurde nicht gefunden.");

  const fillable = ["domain", "industry", "employeeCount", "annualRevenue", "phone", "email", "website", "street", "postalCode", "city", "country", "description"] as const;
  const fill: Record<string, unknown> = {};
  for (const field of fillable) {
    const primaryValue = (primary as unknown as Record<string, unknown>)[field];
    const duplicateValue = (duplicate as unknown as Record<string, unknown>)[field];
    if ((primaryValue === null || primaryValue === undefined || primaryValue === "") && duplicateValue) {
      fill[field] = field === "domain" ? normaliseDomain(String(duplicateValue)) : duplicateValue;
    }
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(fill).length > 0) await tx.company.update({ where: { id: primaryId }, data: fill });

    await tx.contact.updateMany({ where: { companyId: duplicateId }, data: { companyId: primaryId } });
    await tx.deal.updateMany({ where: { companyId: duplicateId }, data: { companyId: primaryId } });
    await tx.activity.updateMany({ where: { companyId: duplicateId }, data: { companyId: primaryId } });
    await tx.task.updateMany({ where: { companyId: duplicateId }, data: { companyId: primaryId } });
    await tx.note.updateMany({ where: { companyId: duplicateId }, data: { companyId: primaryId } });
    await tx.meeting.updateMany({ where: { companyId: duplicateId }, data: { companyId: primaryId } });
    await tx.fileObject.updateMany({ where: { companyId: duplicateId }, data: { companyId: primaryId } });
    await tx.lead.updateMany({ where: { companyId: duplicateId }, data: { companyId: primaryId } });

    const duplicateValues = await tx.propertyValue.findMany({ where: { companyId: duplicateId } });
    for (const value of duplicateValues) {
      const exists = await tx.propertyValue.findFirst({
        where: { definitionId: value.definitionId, companyId: primaryId },
      });
      if (!exists) await tx.propertyValue.update({ where: { id: value.id }, data: { companyId: primaryId } });
    }

    await tx.company.update({ where: { id: duplicateId }, data: { deletedAt: new Date() } });
  });

  await logSystemActivity(ctx, {
    subject: "Unternehmen zusammengeführt",
    links: { companyId: primaryId },
    metadata: { mergedFrom: duplicateId },
  });
  await writeAudit(ctx, {
    action: "company.merged",
    entityType: "Company",
    entityId: primaryId,
    before: { duplicateId, duplicateName: duplicate!.name },
    after: { filledFields: Object.keys(fill) },
  });

  return { primaryId, mergedFields: Object.keys(fill) };
}

/** Checks one incoming record against existing data — used by the CSV import. */
export async function findExistingContact(ctx: ActorContext, email?: string | null) {
  if (!email) return null;
  return prisma.contact.findFirst({ where: { ...liveScope(ctx), email }, select: { id: true } });
}

export async function findExistingCompany(ctx: ActorContext, domain?: string | null, name?: string | null) {
  const normalisedDomain = normaliseDomain(domain);
  if (normalisedDomain) {
    const byDomain = await prisma.company.findFirst({
      where: { ...liveScope(ctx), domain: normalisedDomain },
      select: { id: true },
    });
    if (byDomain) return byDomain;
  }
  if (!name) return null;
  return prisma.company.findFirst({
    where: { ...scope(ctx), deletedAt: null, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
}
