import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { Conflict, ValidationError } from "@/lib/api/errors";
import { INTEGRATIONS } from "@/server/integrations/registry";

/**
 * Administration of the CRM vocabulary: lifecycle stages, lead statuses and
 * tags. System entries are protected because records and workflows reference
 * their keys.
 */
export const optionSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[a-z][a-z0-9_]*$/, "Nur Kleinbuchstaben, Zahlen und Unterstriche."),
  label: z.string().trim().min(1, "Bezeichnung ist erforderlich.").max(80),
  position: z.coerce.number().int().min(0).max(999).default(0),
  isTerminal: z.boolean().optional(),
});

export const tagSchema = z.object({
  name: z.string().trim().min(1, "Name ist erforderlich.").max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Bitte eine Hex-Farbe angeben.")
    .default("#2563EB"),
});

export async function listLifecycleStages(ctx: ActorContext) {
  return prisma.lifecycleStageOption.findMany({ where: scope(ctx), orderBy: { position: "asc" } });
}

export async function listLeadStatuses(ctx: ActorContext) {
  return prisma.leadStatusOption.findMany({ where: scope(ctx), orderBy: { position: "asc" } });
}

export async function createLifecycleStage(ctx: ActorContext, input: z.input<typeof optionSchema>) {
  assertPermission(ctx, "settings.manage");
  const data = optionSchema.parse(input);
  const existing = await prisma.lifecycleStageOption.findFirst({ where: { ...scope(ctx), key: data.key } });
  if (existing) throw Conflict("Dieser Schlüssel wird bereits verwendet.");

  const stage = await prisma.lifecycleStageOption.create({
    data: { organizationId: ctx.organizationId, key: data.key, label: data.label, position: data.position },
  });
  await writeAudit(ctx, { action: "lifecycle_stage.created", entityType: "LifecycleStageOption", entityId: stage.id, after: { key: stage.key } });
  return stage;
}

export async function updateLifecycleStage(ctx: ActorContext, id: string, input: { label: string; position?: number }) {
  assertPermission(ctx, "settings.manage");
  const stage = assertFound(
    await prisma.lifecycleStageOption.findFirst({ where: { id, ...scope(ctx) } }),
    "Die Lifecycle Stage wurde nicht gefunden.",
  );
  const updated = await prisma.lifecycleStageOption.update({
    where: { id: stage.id },
    data: { label: input.label, position: input.position },
  });
  await writeAudit(ctx, {
    action: "lifecycle_stage.updated",
    entityType: "LifecycleStageOption",
    entityId: id,
    before: { label: stage.label },
    after: { label: updated.label },
  });
  return updated;
}

export async function deleteLifecycleStage(ctx: ActorContext, id: string) {
  assertPermission(ctx, "settings.manage");
  const stage = assertFound(
    await prisma.lifecycleStageOption.findFirst({ where: { id, ...scope(ctx) } }),
    "Die Lifecycle Stage wurde nicht gefunden.",
  );
  if (stage.isSystem) throw ValidationError("Diese Stage ist systemrelevant und kann nicht gelöscht werden.");

  const [contacts, companies] = await Promise.all([
    prisma.contact.count({ where: { ...scope(ctx), lifecycleStage: stage.key, deletedAt: null } }),
    prisma.company.count({ where: { ...scope(ctx), lifecycleStage: stage.key, deletedAt: null } }),
  ]);
  if (contacts + companies > 0) {
    throw Conflict(`Diese Stage wird noch von ${contacts + companies} Datensätzen verwendet.`);
  }

  await prisma.lifecycleStageOption.delete({ where: { id: stage.id } });
  await writeAudit(ctx, { action: "lifecycle_stage.deleted", entityType: "LifecycleStageOption", entityId: id, before: { key: stage.key } });
}

export async function createLeadStatus(ctx: ActorContext, input: z.input<typeof optionSchema>) {
  assertPermission(ctx, "settings.manage");
  const data = optionSchema.parse(input);
  const existing = await prisma.leadStatusOption.findFirst({ where: { ...scope(ctx), key: data.key } });
  if (existing) throw Conflict("Dieser Schlüssel wird bereits verwendet.");

  const status = await prisma.leadStatusOption.create({
    data: {
      organizationId: ctx.organizationId,
      key: data.key,
      label: data.label,
      position: data.position,
      isTerminal: data.isTerminal ?? false,
    },
  });
  await writeAudit(ctx, { action: "lead_status.created", entityType: "LeadStatusOption", entityId: status.id, after: { key: status.key } });
  return status;
}

export async function updateLeadStatus(
  ctx: ActorContext,
  id: string,
  input: { label: string; position?: number; isTerminal?: boolean },
) {
  assertPermission(ctx, "settings.manage");
  const status = assertFound(
    await prisma.leadStatusOption.findFirst({ where: { id, ...scope(ctx) } }),
    "Der Lead-Status wurde nicht gefunden.",
  );
  const updated = await prisma.leadStatusOption.update({
    where: { id: status.id },
    data: { label: input.label, position: input.position, isTerminal: input.isTerminal },
  });
  await writeAudit(ctx, {
    action: "lead_status.updated",
    entityType: "LeadStatusOption",
    entityId: id,
    before: { label: status.label },
    after: { label: updated.label },
  });
  return updated;
}

export async function deleteLeadStatus(ctx: ActorContext, id: string) {
  assertPermission(ctx, "settings.manage");
  const status = assertFound(
    await prisma.leadStatusOption.findFirst({ where: { id, ...scope(ctx) } }),
    "Der Lead-Status wurde nicht gefunden.",
  );
  if (status.isSystem) throw ValidationError("Dieser Status ist systemrelevant und kann nicht gelöscht werden.");

  const leads = await prisma.lead.count({ where: { ...scope(ctx), status: status.key, deletedAt: null } });
  if (leads > 0) throw Conflict(`Dieser Status wird noch von ${leads} Leads verwendet.`);

  await prisma.leadStatusOption.delete({ where: { id: status.id } });
  await writeAudit(ctx, { action: "lead_status.deleted", entityType: "LeadStatusOption", entityId: id, before: { key: status.key } });
}

export async function listTags(ctx: ActorContext) {
  return prisma.tag.findMany({
    where: scope(ctx),
    orderBy: { name: "asc" },
    include: { _count: { select: { contacts: true, companies: true, deals: true } } },
  });
}

export async function createTag(ctx: ActorContext, input: z.input<typeof tagSchema>) {
  assertPermission(ctx, "settings.manage");
  const data = tagSchema.parse(input);
  const existing = await prisma.tag.findFirst({ where: { ...scope(ctx), name: data.name } });
  if (existing) throw Conflict("Dieses Tag existiert bereits.");
  return prisma.tag.create({ data: { organizationId: ctx.organizationId, ...data } });
}

export async function deleteTag(ctx: ActorContext, id: string) {
  assertPermission(ctx, "settings.manage");
  const tag = assertFound(await prisma.tag.findFirst({ where: { id, ...scope(ctx) } }), "Das Tag wurde nicht gefunden.");
  await prisma.tag.delete({ where: { id: tag.id } });
  await writeAudit(ctx, { action: "tag.deleted", entityType: "Tag", entityId: id, before: { name: tag.name } });
}

/** Integration catalogue joined with this organization's connection state. */
export async function listIntegrations(ctx: ActorContext) {
  assertPermission(ctx, "settings.manage");
  const connections = await prisma.integrationConnection.findMany({ where: scope(ctx) });

  return INTEGRATIONS.map((descriptor) => {
    const connection = connections.find((item) => item.provider === descriptor.provider);
    return {
      ...descriptor,
      connection: connection
        ? {
            id: connection.id,
            status: connection.status,
            displayName: connection.displayName,
            connectedAt: connection.connectedAt?.toISOString() ?? null,
            lastError: connection.lastError,
          }
        : null,
    };
  });
}
