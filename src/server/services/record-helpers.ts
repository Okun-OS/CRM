import type { CrmObjectType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { ActorContext } from "@/lib/context";
import { liveScope, scope } from "@/lib/tenant";
import { ValidationError } from "@/lib/api/errors";

/**
 * Cross-cutting guards shared by the CRM services. Each of these exists to stop
 * a request from referencing a record in another organization.
 */
export async function assertRelationsExist(
  ctx: ActorContext,
  relations: {
    companyId?: string | null;
    contactId?: string | null;
    dealId?: string | null;
    leadId?: string | null;
    pipelineId?: string | null;
    stageId?: string | null;
  },
): Promise<void> {
  const checks: Promise<{ id: string } | null>[] = [];
  const labels: string[] = [];

  if (relations.companyId) {
    labels.push("Unternehmen");
    checks.push(prisma.company.findFirst({ where: { id: relations.companyId, ...liveScope(ctx) }, select: { id: true } }));
  }
  if (relations.contactId) {
    labels.push("Kontakt");
    checks.push(prisma.contact.findFirst({ where: { id: relations.contactId, ...liveScope(ctx) }, select: { id: true } }));
  }
  if (relations.dealId) {
    labels.push("Deal");
    checks.push(prisma.deal.findFirst({ where: { id: relations.dealId, ...liveScope(ctx) }, select: { id: true } }));
  }
  if (relations.leadId) {
    labels.push("Lead");
    checks.push(prisma.lead.findFirst({ where: { id: relations.leadId, ...liveScope(ctx) }, select: { id: true } }));
  }
  if (relations.pipelineId) {
    labels.push("Pipeline");
    checks.push(prisma.pipeline.findFirst({ where: { id: relations.pipelineId, ...scope(ctx) }, select: { id: true } }));
  }
  if (relations.stageId) {
    labels.push("Stage");
    checks.push(prisma.pipelineStage.findFirst({ where: { id: relations.stageId, ...scope(ctx) }, select: { id: true } }));
  }

  const results = await Promise.all(checks);
  const missingIndex = results.findIndex((result) => result === null);
  if (missingIndex >= 0) {
    throw ValidationError(`Verknüpfung ungültig: ${labels[missingIndex]} wurde nicht gefunden.`);
  }
}

/** An owner must be an active member of the same organization. */
export async function assertOwnerInOrganization(ctx: ActorContext, ownerId?: string | null): Promise<void> {
  if (!ownerId) return;
  const membership = await prisma.membership.findFirst({
    where: { userId: ownerId, organizationId: ctx.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) throw ValidationError("Der gewählte Owner ist kein aktives Mitglied dieser Organisation.");
}

const TAG_LINK = {
  CONTACT: "contactTag",
  COMPANY: "companyTag",
  DEAL: "dealTag",
} as const;

/** Replaces the tag set of a record, rejecting tags from other organizations. */
export async function syncTags(
  ctx: ActorContext,
  objectType: Extract<CrmObjectType, "CONTACT" | "COMPANY" | "DEAL">,
  entityId: string,
  tagIds: string[],
): Promise<void> {
  const unique = Array.from(new Set(tagIds));
  if (unique.length > 0) {
    const found = await prisma.tag.count({ where: { id: { in: unique }, ...scope(ctx) } });
    if (found !== unique.length) throw ValidationError("Mindestens ein Tag gehört nicht zu dieser Organisation.");
  }

  const column = objectType === "CONTACT" ? "contactId" : objectType === "COMPANY" ? "companyId" : "dealId";
  const delegate = prisma[TAG_LINK[objectType]] as unknown as {
    deleteMany: (args: unknown) => Promise<unknown>;
    createMany: (args: unknown) => Promise<unknown>;
  };

  await delegate.deleteMany({ where: { [column]: entityId } });
  if (unique.length > 0) {
    await delegate.createMany({
      data: unique.map((tagId) => ({ [column]: entityId, tagId })),
      skipDuplicates: true,
    });
  }
}

/** Members of the organization, for owner pickers and assignment validation. */
export async function listOrganizationMembers(ctx: ActorContext) {
  const memberships = await prisma.membership.findMany({
    where: { ...scope(ctx), status: "ACTIVE" },
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      team: { select: { id: true, name: true } },
    },
    orderBy: { user: { name: "asc" } },
  });
  return memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    avatarUrl: membership.user.avatarUrl,
    role: membership.role,
    team: membership.team,
  }));
}
