import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ProspectStage } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { paginate, paginationSchema, skipTake } from "@/lib/api/pagination";
import { Conflict, ValidationError } from "@/lib/api/errors";
import { optionalEmail } from "@/lib/schemas/crm";
import { assertStageTransition } from "./lifecycle";
import { checkSuppression, domainOf } from "./suppression";
import type { ProspectCandidate } from "@/server/acquisition/providers/types";

/**
 * Prospects — potenzielle Kunden, bevor sie Kontakte sind.
 *
 * Der Dienst hält drei Dinge zusammen, die sonst auseinanderlaufen: den
 * Lebenszyklus, die Herkunft jedes einzelnen Feldes und die Kontaktsperre.
 * Alles andere — Listen, Sequenzen, Konvertierung — baut darauf auf.
 */

export const prospectInputSchema = z.object({
  companyName: z.string().trim().min(1, "Firmenname ist erforderlich.").max(160),
  domain: z.string().trim().max(160).optional(),
  website: z.string().trim().max(500).optional(),
  industry: z.string().trim().max(120).optional(),
  employeeCount: z.coerce.number().int().min(0).max(10_000_000).nullish(),
  street: z.string().trim().max(160).optional(),
  postalCode: z.string().trim().max(20).optional(),
  city: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  email: optionalEmail,
  jobTitle: z.string().trim().max(120).optional(),
  linkedinUrl: z.string().trim().max(500).optional(),
  sourceKey: z.string().trim().min(1).max(40).default("manual"),
  sourceRef: z.string().trim().max(200).optional(),
  score: z.coerce.number().int().min(0).max(100).nullish(),
  scoreReason: z.string().trim().max(300).optional(),
  qualification: z.string().trim().max(5000).optional(),
  lawfulBasis: z
    .enum(["UNREVIEWED", "CLAIMED_LEGITIMATE_INTEREST", "CLAIMED_CONSENT", "EXISTING_CUSTOMER", "REJECTED"])
    .default("UNREVIEWED"),
  lawfulBasisNote: z.string().trim().max(500).optional(),
  ownerId: z.string().max(30).optional(),
  properties: z.record(z.string().max(48), z.unknown()).optional(),
});

export const prospectUpdateSchema = prospectInputSchema.partial().omit({ sourceKey: true, sourceRef: true });

export const prospectStageSchema = z.object({
  stage: z.enum([
    "NEW",
    "RESEARCHING",
    "QUALIFIED",
    "READY",
    "IN_SEQUENCE",
    "REPLIED",
    "INTERESTED",
    "NOT_INTERESTED",
    "MEETING",
    "DISQUALIFIED",
    "DO_NOT_CONTACT",
  ]),
  reason: z.string().trim().max(500).optional(),
});

export const prospectListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  stage: z.string().trim().max(40).optional(),
  ownerId: z.string().max(30).optional(),
  listId: z.string().max(30).optional(),
  sourceKey: z.string().max(40).optional(),
  /** Nur solche, die angesprochen werden dürfen. */
  contactable: z.enum(["true", "false"]).optional(),
});

const include = {
  owner: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  company: { select: { id: true, name: true } },
  deal: { select: { id: true, name: true } },
  _count: { select: { enrollments: true, listMemberships: true } },
} satisfies Prisma.ProspectInclude;

type ProspectRow = Prisma.ProspectGetPayload<{ include: typeof include }>;

function present(row: ProspectRow) {
  return {
    id: row.id,
    stage: row.stage,
    companyName: row.companyName,
    domain: row.domain,
    website: row.website,
    industry: row.industry,
    employeeCount: row.employeeCount,
    street: row.street,
    postalCode: row.postalCode,
    city: row.city,
    country: row.country,
    phone: row.phone,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    jobTitle: row.jobTitle,
    linkedinUrl: row.linkedinUrl,
    sourceKey: row.sourceKey,
    sourceRef: row.sourceRef,
    score: row.score,
    scoreReason: row.scoreReason,
    qualification: row.qualification,
    disqualifiedReason: row.disqualifiedReason,
    lawfulBasis: row.lawfulBasis,
    lawfulBasisNote: row.lawfulBasisNote,
    owner: row.owner,
    contact: row.contact,
    company: row.company,
    deal: row.deal,
    convertedAt: row.convertedAt?.toISOString() ?? null,
    qualifiedAt: row.qualifiedAt?.toISOString() ?? null,
    firstContactedAt: row.firstContactedAt?.toISOString() ?? null,
    lastContactedAt: row.lastContactedAt?.toISOString() ?? null,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    interestedAt: row.interestedAt?.toISOString() ?? null,
    meetingAt: row.meetingAt?.toISOString() ?? null,
    properties: (row.properties as Record<string, unknown> | null) ?? {},
    enrollmentCount: row._count.enrollments,
    listCount: row._count.listMemberships,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type ProspectDTO = ReturnType<typeof present>;

export async function listProspects(ctx: ActorContext, query: z.infer<typeof prospectListQuerySchema>) {
  assertPermission(ctx, "prospects.read");

  const where: Prisma.ProspectWhereInput = {
    ...scope(ctx),
    deletedAt: null,
    ...(query.stage ? { stage: query.stage as ProspectStage } : {}),
    ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(query.sourceKey ? { sourceKey: query.sourceKey } : {}),
    ...(query.listId ? { listMemberships: { some: { listId: query.listId } } } : {}),
    ...(query.contactable === "true" ? { stage: { in: ["READY", "QUALIFIED"] }, NOT: { email: null } } : {}),
    ...(query.search
      ? {
          OR: [
            { companyName: { contains: query.search, mode: "insensitive" } },
            { domain: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
            { lastName: { contains: query.search, mode: "insensitive" } },
            { city: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.prospect.findMany({ where, include, orderBy: { updatedAt: "desc" }, ...skipTake(query) }),
    prisma.prospect.count({ where }),
  ]);

  return paginate(rows.map(present), total, query);
}

export async function getProspect(ctx: ActorContext, id: string) {
  assertPermission(ctx, "prospects.read");
  const row = assertFound(
    await prisma.prospect.findFirst({ where: { id, ...scope(ctx), deletedAt: null }, include }),
    "Der Prospect wurde nicht gefunden.",
  );

  const [provenance, suppression] = await Promise.all([
    prisma.provenanceRecord.findMany({
      where: { prospectId: row.id, organizationId: ctx.organizationId },
      orderBy: { observedAt: "desc" },
    }),
    checkSuppression(ctx.organizationId, row.email),
  ]);

  return {
    ...present(row),
    // Herkunft je Feld — die Antwort auf „woher stammt dieser Wert?".
    provenance: provenance.map((entry) => ({
      field: entry.field,
      sourceKey: entry.sourceKey,
      reference: entry.reference,
      confidence: entry.confidence,
      observedAt: entry.observedAt.toISOString(),
    })),
    suppression: suppression.blocked ? { blocked: true, reason: suppression.reason } : { blocked: false },
  };
}

/**
 * Sucht einen bereits vorhandenen Prospect zum selben Gegenüber.
 *
 * Reihenfolge mit Absicht: Die E-Mail-Adresse identifiziert einen Menschen,
 * die Domain nur ein Unternehmen. Ein zweiter Ansprechpartner derselben Firma
 * ist ein eigener Prospect, dieselbe Adresse dagegen eine Dublette.
 */
async function findExisting(organizationId: string, candidate: { email?: string | null; domain?: string | null; companyName: string }) {
  if (candidate.email) {
    const byEmail = await prisma.prospect.findFirst({
      where: { organizationId, deletedAt: null, email: candidate.email.toLowerCase() },
    });
    if (byEmail) return byEmail;
  }
  if (candidate.domain) {
    const byDomain = await prisma.prospect.findFirst({
      where: { organizationId, deletedAt: null, domain: candidate.domain.toLowerCase(), email: null },
    });
    if (byDomain) return byDomain;
  }
  return null;
}

export async function createProspect(ctx: ActorContext, input: z.input<typeof prospectInputSchema>) {
  assertPermission(ctx, "prospects.write");
  const data = prospectInputSchema.parse(input);
  const domain = data.domain?.toLowerCase() ?? domainOf(data.email);

  const existing = await findExisting(ctx.organizationId, {
    email: data.email,
    domain,
    companyName: data.companyName,
  });
  if (existing) {
    throw Conflict(
      `Zu „${existing.companyName}" existiert bereits ein Prospect mit denselben Kontaktdaten.`,
    );
  }

  const suppression = await checkSuppression(ctx.organizationId, data.email);

  const prospect = await prisma.prospect.create({
    data: {
      organizationId: ctx.organizationId,
      companyName: data.companyName,
      domain,
      website: data.website,
      industry: data.industry,
      employeeCount: data.employeeCount ?? null,
      street: data.street,
      postalCode: data.postalCode,
      city: data.city,
      country: data.country,
      phone: data.phone,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      jobTitle: data.jobTitle,
      linkedinUrl: data.linkedinUrl,
      sourceKey: data.sourceKey,
      sourceRef: data.sourceRef,
      score: data.score ?? null,
      scoreReason: data.scoreReason,
      qualification: data.qualification,
      lawfulBasis: data.lawfulBasis,
      lawfulBasisNote: data.lawfulBasisNote,
      ownerId: data.ownerId ?? ctx.userId,
      createdById: ctx.userId,
      properties: (data.properties ?? undefined) as Prisma.InputJsonValue | undefined,
      // Eine bestehende Sperre schlägt sofort auf die Stufe durch: Der
      // Datensatz darf entstehen, die Ansprache aber nicht.
      stage: suppression.blocked ? "DO_NOT_CONTACT" : "NEW",
    },
    include,
  });

  await writeAudit(ctx, {
    action: "prospect.created",
    entityType: "Prospect",
    entityId: prospect.id,
    after: { companyName: prospect.companyName, email: prospect.email, source: prospect.sourceKey },
  });

  await emitDomainEvent(ctx, {
    name: "prospect.created",
    entityType: "PROSPECT",
    entityId: prospect.id,
    payload: { companyName: prospect.companyName, sourceKey: prospect.sourceKey },
  });

  return present(prospect);
}

/** Schreibt die Herkunft der Felder, die eine Quelle geliefert hat. */
export async function recordProvenance(
  organizationId: string,
  prospectId: string,
  sourceKey: string,
  entries: ProspectCandidate["provenance"],
) {
  if (!entries || entries.length === 0) return;
  await prisma.provenanceRecord.createMany({
    data: entries.map((entry) => ({
      organizationId,
      prospectId,
      field: entry.field,
      sourceKey,
      reference: entry.reference ?? null,
      confidence: entry.confidence ?? null,
    })),
  });
}

export async function updateProspect(ctx: ActorContext, id: string, input: z.input<typeof prospectUpdateSchema>) {
  assertPermission(ctx, "prospects.write");
  const data = prospectUpdateSchema.parse(input);

  const existing = assertFound(
    await prisma.prospect.findFirst({ where: { id, ...scope(ctx), deletedAt: null } }),
    "Der Prospect wurde nicht gefunden.",
  );

  const prospect = await prisma.prospect.update({
    where: { id: existing.id },
    data: {
      ...data,
      employeeCount: data.employeeCount ?? undefined,
      score: data.score ?? undefined,
      domain: data.domain ? data.domain.toLowerCase() : undefined,
      properties: (data.properties ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    include,
  });

  await writeAudit(ctx, {
    action: "prospect.updated",
    entityType: "Prospect",
    entityId: prospect.id,
    before: { companyName: existing.companyName, email: existing.email, score: existing.score },
    after: { companyName: prospect.companyName, email: prospect.email, score: prospect.score },
  });

  return present(prospect);
}

/** Wechselt die Stufe — mit geprüftem Übergang und nachvollziehbarem Grund. */
export async function changeProspectStage(ctx: ActorContext, id: string, input: z.input<typeof prospectStageSchema>) {
  assertPermission(ctx, "prospects.write");
  const data = prospectStageSchema.parse(input);

  const existing = assertFound(
    await prisma.prospect.findFirst({ where: { id, ...scope(ctx), deletedAt: null } }),
    "Der Prospect wurde nicht gefunden.",
  );

  assertStageTransition(existing.stage, data.stage);
  if (data.stage === "DISQUALIFIED" && !data.reason) {
    throw ValidationError("Bitte begründen Sie, warum dieser Prospect aussortiert wird.");
  }

  const now = new Date();
  const prospect = await prisma.prospect.update({
    where: { id: existing.id },
    data: {
      stage: data.stage,
      disqualifiedReason: data.stage === "DISQUALIFIED" ? data.reason : existing.disqualifiedReason,
      qualifiedAt: data.stage === "QUALIFIED" && !existing.qualifiedAt ? now : existing.qualifiedAt,
      repliedAt: data.stage === "REPLIED" && !existing.repliedAt ? now : existing.repliedAt,
      interestedAt: data.stage === "INTERESTED" && !existing.interestedAt ? now : existing.interestedAt,
      meetingAt: data.stage === "MEETING" && !existing.meetingAt ? now : existing.meetingAt,
    },
    include,
  });

  await writeAudit(ctx, {
    action: "prospect.stage_changed",
    entityType: "Prospect",
    entityId: prospect.id,
    before: { stage: existing.stage },
    after: { stage: prospect.stage, reason: data.reason ?? null },
  });

  const EVENTS: Partial<Record<ProspectStage, "prospect.qualified" | "prospect.interested" | "prospect.disqualified">> = {
    QUALIFIED: "prospect.qualified",
    INTERESTED: "prospect.interested",
    DISQUALIFIED: "prospect.disqualified",
  };
  const eventName = EVENTS[data.stage];
  if (eventName) {
    await emitDomainEvent(ctx, {
      name: eventName,
      entityType: "PROSPECT",
      entityId: prospect.id,
      payload: { stage: prospect.stage, reason: data.reason ?? null },
    });
  }

  return present(prospect);
}

export async function deleteProspect(ctx: ActorContext, id: string) {
  assertPermission(ctx, "prospects.delete");
  const existing = assertFound(
    await prisma.prospect.findFirst({ where: { id, ...scope(ctx), deletedAt: null } }),
    "Der Prospect wurde nicht gefunden.",
  );

  if (existing.convertedAt) {
    throw Conflict(
      "Dieser Prospect wurde bereits ins CRM übernommen. Er trägt die Herkunft des Kunden und bleibt deshalb erhalten.",
    );
  }

  await prisma.prospect.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  await writeAudit(ctx, {
    action: "prospect.deleted",
    entityType: "Prospect",
    entityId: id,
    before: { companyName: existing.companyName, email: existing.email },
  });
}
