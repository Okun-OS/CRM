import { z } from "zod";
import type { ActivityType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { liveScope, scope } from "@/lib/tenant";
import { paginate, paginationSchema, skipTake } from "@/lib/api/pagination";
import { activityInputSchema } from "@/lib/schemas/crm";
import { ValidationError } from "@/lib/api/errors";

/**
 * The activity table is the CRM timeline: manually logged engagement (calls,
 * e-mails, meetings, notes) and system events (record created, stage changed,
 * workflow actions) share one chronological stream per record.
 */
export type ActivityLinks = {
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
};

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  CALL: "Anruf",
  EMAIL: "E-Mail",
  MEETING: "Meeting",
  NOTE: "Notiz",
  TASK: "Aufgabe",
  SYSTEM: "System",
};

export const activityListQuerySchema = paginationSchema.extend({
  contactId: z.string().max(30).optional(),
  companyId: z.string().max(30).optional(),
  dealId: z.string().max(30).optional(),
  leadId: z.string().max(30).optional(),
  ownerId: z.string().max(30).optional(),
  types: z.array(z.enum(["CALL", "EMAIL", "MEETING", "NOTE", "TASK", "SYSTEM"])).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;

export type ActivityDTO = {
  id: string;
  type: ActivityType;
  source: string;
  subject: string | null;
  body: string | null;
  direction: string | null;
  outcome: string | null;
  durationMinutes: number | null;
  occurredAt: string;
  metadata: unknown;
  actor: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
  lead: { id: string; name: string } | null;
};

const activityInclude = {
  actor: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  company: { select: { id: true, name: true } },
  deal: { select: { id: true, name: true } },
  lead: { select: { id: true, firstName: true, lastName: true, companyName: true } },
} as const;

type ActivityRow = {
  id: string;
  type: ActivityType;
  source: string;
  subject: string | null;
  body: string | null;
  direction: string | null;
  outcome: string | null;
  durationMinutes: number | null;
  occurredAt: Date;
  metadata: unknown;
  actor: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
  lead: { id: string; firstName: string | null; lastName: string | null; companyName: string | null } | null;
};

export function mapActivity(row: ActivityRow): ActivityDTO {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    subject: row.subject,
    body: row.body,
    direction: row.direction,
    outcome: row.outcome,
    durationMinutes: row.durationMinutes,
    occurredAt: row.occurredAt.toISOString(),
    metadata: row.metadata,
    actor: row.actor,
    contact: row.contact ? { id: row.contact.id, name: `${row.contact.firstName} ${row.contact.lastName}`.trim() } : null,
    company: row.company,
    deal: row.deal,
    lead: row.lead
      ? {
          id: row.lead.id,
          name:
            [row.lead.firstName, row.lead.lastName].filter(Boolean).join(" ") ||
            row.lead.companyName ||
            "Lead",
        }
      : null,
  };
}

export async function listActivities(ctx: ActorContext, query: ActivityListQuery) {
  assertPermission(ctx, "activities.read");

  const where = {
    ...scope(ctx),
    ...(query.contactId ? { contactId: query.contactId } : {}),
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(query.dealId ? { dealId: query.dealId } : {}),
    ...(query.leadId ? { leadId: query.leadId } : {}),
    ...(query.ownerId ? { actorId: query.ownerId } : {}),
    ...(query.types?.length ? { type: { in: query.types } } : {}),
    ...(query.from || query.to
      ? { occurredAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      include: activityInclude,
      orderBy: { occurredAt: "desc" },
      ...skipTake(query),
    }),
    prisma.activity.count({ where }),
  ]);

  return paginate(rows.map((row) => mapActivity(row as ActivityRow)), total, query);
}

/** Verifies that every linked record belongs to the actor's organization. */
export async function assertLinksInTenant(ctx: ActorContext, links: ActivityLinks): Promise<void> {
  const checks: Promise<unknown>[] = [];
  if (links.contactId) {
    checks.push(prisma.contact.findFirst({ where: { id: links.contactId, ...liveScope(ctx) }, select: { id: true } }));
  }
  if (links.companyId) {
    checks.push(prisma.company.findFirst({ where: { id: links.companyId, ...liveScope(ctx) }, select: { id: true } }));
  }
  if (links.dealId) {
    checks.push(prisma.deal.findFirst({ where: { id: links.dealId, ...liveScope(ctx) }, select: { id: true } }));
  }
  if (links.leadId) {
    checks.push(prisma.lead.findFirst({ where: { id: links.leadId, ...liveScope(ctx) }, select: { id: true } }));
  }
  const results = await Promise.all(checks);
  if (results.some((result) => result === null)) {
    throw ValidationError("Ein verknüpfter Datensatz gehört nicht zu dieser Organisation.");
  }
}

/** Keeps the denormalised `lastActivityAt` fields in sync for list views. */
export async function touchLastActivity(
  ctx: ActorContext,
  links: ActivityLinks,
  occurredAt: Date = new Date(),
): Promise<void> {
  const updates: Promise<unknown>[] = [];
  if (links.contactId) {
    updates.push(
      prisma.contact.updateMany({ where: { id: links.contactId, ...scope(ctx) }, data: { lastActivityAt: occurredAt } }),
    );
  }
  if (links.companyId) {
    updates.push(
      prisma.company.updateMany({ where: { id: links.companyId, ...scope(ctx) }, data: { lastActivityAt: occurredAt } }),
    );
  }
  if (links.dealId) {
    updates.push(
      prisma.deal.updateMany({ where: { id: links.dealId, ...scope(ctx) }, data: { lastActivityAt: occurredAt } }),
    );
  }
  if (links.leadId) {
    updates.push(
      prisma.lead.updateMany({ where: { id: links.leadId, ...scope(ctx) }, data: { lastActivityAt: occurredAt } }),
    );
  }
  await Promise.all(updates);
}

export async function createActivity(ctx: ActorContext, input: z.input<typeof activityInputSchema>) {
  assertPermission(ctx, "activities.write");
  const data = activityInputSchema.parse(input);

  const links: ActivityLinks = {
    contactId: data.contactId ?? null,
    companyId: data.companyId ?? null,
    dealId: data.dealId ?? null,
    leadId: data.leadId ?? null,
  };
  if (!links.contactId && !links.companyId && !links.dealId && !links.leadId) {
    throw ValidationError("Eine Aktivität muss mit mindestens einem Datensatz verknüpft sein.");
  }
  await assertLinksInTenant(ctx, links);

  const occurredAt = data.occurredAt ?? new Date();
  const activity = await prisma.activity.create({
    data: {
      organizationId: ctx.organizationId,
      type: data.type,
      source: "MANUAL",
      subject: data.subject,
      body: data.body,
      direction: data.direction,
      outcome: data.outcome,
      durationMinutes: data.durationMinutes,
      occurredAt,
      actorId: ctx.userId,
      ...links,
    },
    include: activityInclude,
  });

  await touchLastActivity(ctx, links, occurredAt);
  return mapActivity(activity as ActivityRow);
}

/**
 * Writes a system timeline entry. Used by services and the workflow engine so
 * that every automated change is visible to the user.
 */
export async function logSystemActivity(
  ctx: ActorContext,
  input: {
    subject: string;
    body?: string;
    links: ActivityLinks;
    metadata?: Record<string, unknown>;
    source?: "SYSTEM" | "WORKFLOW" | "IMPORT";
    type?: ActivityType;
  },
): Promise<void> {
  await prisma.activity.create({
    data: {
      organizationId: ctx.organizationId,
      type: input.type ?? "SYSTEM",
      source: input.source ?? "SYSTEM",
      subject: input.subject,
      body: input.body,
      occurredAt: new Date(),
      actorId: ctx.userId,
      metadata: input.metadata as never,
      contactId: input.links.contactId ?? null,
      companyId: input.links.companyId ?? null,
      dealId: input.links.dealId ?? null,
      leadId: input.links.leadId ?? null,
    },
  });
}
