import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Tx } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { Conflict } from "@/lib/api/errors";

/**
 * Organizations are the tenant boundary. A new organization is provisioned with
 * a usable CRM vocabulary — lifecycle stages, lead statuses and a default
 * pipeline — so the product is workable from the first login without demo data.
 */
export const DEFAULT_LIFECYCLE_STAGES = [
  { key: "subscriber", label: "Abonnent" },
  { key: "lead", label: "Lead" },
  { key: "marketing_qualified", label: "Marketing-qualifiziert" },
  { key: "sales_qualified", label: "Vertriebsqualifiziert" },
  { key: "opportunity", label: "Opportunity" },
  { key: "customer", label: "Kunde" },
  { key: "partner", label: "Partner" },
];

export const DEFAULT_LEAD_STATUSES = [
  { key: "new", label: "Neu", isTerminal: false },
  { key: "attempted", label: "Kontaktversuch", isTerminal: false },
  { key: "contacted", label: "Kontaktiert", isTerminal: false },
  { key: "qualified", label: "Qualifiziert", isTerminal: false },
  { key: "unqualified", label: "Unqualifiziert", isTerminal: true },
  { key: "converted", label: "In Deal konvertiert", isTerminal: true },
];

export const DEFAULT_PIPELINE = {
  name: "Vertriebspipeline",
  stages: [
    { key: "lead", name: "Lead", probability: 10, type: "OPEN" as const },
    { key: "qualified", name: "Qualifiziert", probability: 25, type: "OPEN" as const },
    { key: "meeting", name: "Termin", probability: 40, type: "OPEN" as const },
    { key: "proposal", name: "Angebot", probability: 60, type: "OPEN" as const },
    { key: "negotiation", name: "Verhandlung", probability: 80, type: "OPEN" as const },
    { key: "won", name: "Gewonnen", probability: 100, type: "WON" as const },
    { key: "lost", name: "Verloren", probability: 0, type: "LOST" as const },
  ],
};

export const organizationSettingsSchema = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich.").max(120),
  domain: z.string().trim().max(160).optional(),
  industry: z.string().trim().max(120).optional(),
  currency: z.string().length(3).default("EUR"),
  timezone: z.string().max(60).default("Europe/Berlin"),
  locale: z.string().max(10).default("de-DE"),
});

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "organisation";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const existing = await prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  throw Conflict("Es konnte kein eindeutiger Organisations-Slug erzeugt werden.");
}

/** Creates the tenant together with its default CRM configuration. */
export async function provisionOrganization(
  tx: Tx,
  input: { name: string; slug: string; currency?: string; timezone?: string; locale?: string },
) {
  const organization = await tx.organization.create({
    data: {
      name: input.name,
      slug: input.slug,
      currency: input.currency ?? "EUR",
      timezone: input.timezone ?? "Europe/Berlin",
      locale: input.locale ?? "de-DE",
    },
  });

  await tx.lifecycleStageOption.createMany({
    data: DEFAULT_LIFECYCLE_STAGES.map((stage, index) => ({
      organizationId: organization.id,
      key: stage.key,
      label: stage.label,
      position: index,
      isSystem: stage.key === "lead" || stage.key === "customer",
    })),
  });

  await tx.leadStatusOption.createMany({
    data: DEFAULT_LEAD_STATUSES.map((status, index) => ({
      organizationId: organization.id,
      key: status.key,
      label: status.label,
      position: index,
      isTerminal: status.isTerminal,
      isSystem: status.key === "new" || status.key === "converted",
    })),
  });

  await tx.pipeline.create({
    data: {
      organizationId: organization.id,
      name: DEFAULT_PIPELINE.name,
      isDefault: true,
      position: 0,
      stages: {
        create: DEFAULT_PIPELINE.stages.map((stage, index) => ({
          organizationId: organization.id,
          key: stage.key,
          name: stage.name,
          position: index,
          probability: stage.probability,
          type: stage.type,
        })),
      },
    },
  });

  return organization;
}

export async function createOrganizationSlug(name: string): Promise<string> {
  return uniqueSlug(name);
}

export async function getOrganization(ctx: ActorContext) {
  const organization = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
    include: { _count: { select: { memberships: true, contacts: true, companies: true, deals: true } } },
  });
  if (!organization) return null;

  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    domain: organization.domain,
    industry: organization.industry,
    currency: organization.currency,
    timezone: organization.timezone,
    locale: organization.locale,
    onboardingCompletedAt: organization.onboardingCompletedAt?.toISOString() ?? null,
    createdAt: organization.createdAt.toISOString(),
    counts: {
      members: organization._count.memberships,
      contacts: organization._count.contacts,
      companies: organization._count.companies,
      deals: organization._count.deals,
    },
  };
}

export async function updateOrganization(ctx: ActorContext, input: z.input<typeof organizationSettingsSchema>) {
  assertPermission(ctx, "organization.manage");
  const data = organizationSettingsSchema.parse(input);

  const before = await prisma.organization.findUnique({ where: { id: ctx.organizationId } });
  const organization = await prisma.organization.update({ where: { id: ctx.organizationId }, data });

  await writeAudit(ctx, {
    action: "organization.updated",
    entityType: "Organization",
    entityId: organization.id,
    before: { name: before?.name, currency: before?.currency, timezone: before?.timezone },
    after: { name: organization.name, currency: organization.currency, timezone: organization.timezone },
  });

  return getOrganization(ctx);
}

export async function completeOnboarding(ctx: ActorContext) {
  assertPermission(ctx, "settings.manage");
  await prisma.organization.update({
    where: { id: ctx.organizationId },
    data: { onboardingCompletedAt: new Date() },
  });
  await writeAudit(ctx, { action: "organization.onboarding_completed", entityType: "Organization", entityId: ctx.organizationId });
}

/** Drives the first-run setup checklist — every step reflects real data. */
export async function onboardingStatus(ctx: ActorContext) {
  const [organization, members, pipelines, contacts, companies, deals, integrations] = await Promise.all([
    prisma.organization.findUnique({ where: { id: ctx.organizationId } }),
    prisma.membership.count({ where: scope(ctx) }),
    prisma.pipeline.count({ where: { ...scope(ctx), isArchived: false } }),
    prisma.contact.count({ where: { ...scope(ctx), deletedAt: null } }),
    prisma.company.count({ where: { ...scope(ctx), deletedAt: null } }),
    prisma.deal.count({ where: { ...scope(ctx), deletedAt: null } }),
    prisma.integrationConnection.count({ where: { ...scope(ctx), status: "CONNECTED" } }),
  ]);

  const steps = [
    {
      key: "profile",
      label: "Unternehmensprofil vervollständigen",
      done: Boolean(organization?.industry || organization?.domain),
      href: "/settings/organization",
    },
    { key: "team", label: "Team einladen", done: members > 1, href: "/settings/users" },
    { key: "pipeline", label: "Pipeline prüfen", done: pipelines > 0, href: "/settings/pipelines" },
    { key: "contacts", label: "Kontakte anlegen oder importieren", done: contacts > 0, href: "/contacts" },
    { key: "companies", label: "Unternehmen erfassen", done: companies > 0, href: "/companies" },
    { key: "deals", label: "Ersten Deal anlegen", done: deals > 0, href: "/deals" },
    { key: "integrations", label: "Integrationen verbinden (optional)", done: integrations > 0, href: "/settings/integrations", optional: true },
  ];

  const required = steps.filter((step) => !step.optional);
  return {
    completed: Boolean(organization?.onboardingCompletedAt),
    steps,
    progress: Math.round((required.filter((step) => step.done).length / required.length) * 100),
  };
}
