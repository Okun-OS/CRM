import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { scope, assertFound } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { paginate, paginationSchema, skipTake } from "@/lib/api/pagination";
import { ValidationError } from "@/lib/api/errors";
import { workflowInputSchema } from "@/server/workflows/types";

/** CRUD for workflow definitions plus read access to their execution log. */
export async function listWorkflows(ctx: ActorContext) {
  assertPermission(ctx, "workflows.read");
  const workflows = await prisma.workflow.findMany({
    where: scope(ctx),
    include: {
      createdBy: { select: { id: true, name: true } },
      _count: { select: { executions: true } },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  return workflows.map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    objectType: workflow.objectType,
    triggerType: workflow.triggerType,
    triggerConfig: workflow.triggerConfig,
    conditions: workflow.conditions,
    actions: workflow.actions,
    isActive: workflow.isActive,
    runCount: workflow.runCount,
    lastRunAt: workflow.lastRunAt?.toISOString() ?? null,
    executionCount: workflow._count.executions,
    createdBy: workflow.createdBy,
    createdAt: workflow.createdAt.toISOString(),
  }));
}

export async function getWorkflow(ctx: ActorContext, id: string) {
  assertPermission(ctx, "workflows.read");
  const workflow = assertFound(
    await prisma.workflow.findFirst({
      where: { id, ...scope(ctx) },
      include: { createdBy: { select: { id: true, name: true } } },
    }),
    "Der Workflow wurde nicht gefunden.",
  );
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    objectType: workflow.objectType,
    triggerType: workflow.triggerType,
    triggerConfig: workflow.triggerConfig,
    conditions: workflow.conditions,
    actions: workflow.actions,
    isActive: workflow.isActive,
    runCount: workflow.runCount,
    lastRunAt: workflow.lastRunAt?.toISOString() ?? null,
    createdBy: workflow.createdBy,
    createdAt: workflow.createdAt.toISOString(),
  };
}

export async function createWorkflow(ctx: ActorContext, input: z.input<typeof workflowInputSchema>) {
  assertPermission(ctx, "workflows.manage");
  const data = workflowInputSchema.parse(input);
  await assertActionTargetsExist(ctx, data);

  const workflow = await prisma.workflow.create({
    data: {
      organizationId: ctx.organizationId,
      name: data.name,
      description: data.description,
      objectType: data.objectType,
      triggerType: data.triggerType,
      triggerConfig: data.triggerConfig as never,
      conditions: data.conditions as never,
      actions: data.actions as never,
      isActive: data.isActive,
      createdById: ctx.userId,
    },
  });

  await writeAudit(ctx, {
    action: "workflow.created",
    entityType: "Workflow",
    entityId: workflow.id,
    after: { name: workflow.name, trigger: workflow.triggerType, isActive: workflow.isActive },
  });
  return workflow;
}

export async function updateWorkflow(ctx: ActorContext, id: string, input: z.input<typeof workflowInputSchema>) {
  assertPermission(ctx, "workflows.manage");
  const data = workflowInputSchema.parse(input);
  await assertActionTargetsExist(ctx, data);

  const existing = assertFound(
    await prisma.workflow.findFirst({ where: { id, ...scope(ctx) } }),
    "Der Workflow wurde nicht gefunden.",
  );

  const workflow = await prisma.workflow.update({
    where: { id: existing.id },
    data: {
      name: data.name,
      description: data.description,
      objectType: data.objectType,
      triggerType: data.triggerType,
      triggerConfig: data.triggerConfig as never,
      conditions: data.conditions as never,
      actions: data.actions as never,
      isActive: data.isActive,
    },
  });

  await writeAudit(ctx, {
    action: "workflow.updated",
    entityType: "Workflow",
    entityId: id,
    before: { name: existing.name, isActive: existing.isActive, trigger: existing.triggerType },
    after: { name: workflow.name, isActive: workflow.isActive, trigger: workflow.triggerType },
  });
  return workflow;
}

export async function setWorkflowActive(ctx: ActorContext, id: string, isActive: boolean) {
  assertPermission(ctx, "workflows.manage");
  const existing = assertFound(
    await prisma.workflow.findFirst({ where: { id, ...scope(ctx) } }),
    "Der Workflow wurde nicht gefunden.",
  );
  await prisma.workflow.update({ where: { id: existing.id }, data: { isActive } });
  await writeAudit(ctx, {
    action: isActive ? "workflow.activated" : "workflow.deactivated",
    entityType: "Workflow",
    entityId: id,
    after: { isActive },
  });
}

export async function deleteWorkflow(ctx: ActorContext, id: string) {
  assertPermission(ctx, "workflows.manage");
  const existing = assertFound(
    await prisma.workflow.findFirst({ where: { id, ...scope(ctx) } }),
    "Der Workflow wurde nicht gefunden.",
  );
  await prisma.workflow.delete({ where: { id: existing.id } });
  await writeAudit(ctx, { action: "workflow.deleted", entityType: "Workflow", entityId: id, before: { name: existing.name } });
}

export const executionQuerySchema = paginationSchema.extend({ workflowId: z.string().max(30).optional() });

export async function listExecutions(ctx: ActorContext, query: z.infer<typeof executionQuerySchema>) {
  assertPermission(ctx, "workflows.read");
  const where = { ...scope(ctx), ...(query.workflowId ? { workflowId: query.workflowId } : {}) };

  const [rows, total] = await Promise.all([
    prisma.workflowExecution.findMany({
      where,
      orderBy: { startedAt: "desc" },
      ...skipTake(query),
      include: { workflow: { select: { id: true, name: true } } },
    }),
    prisma.workflowExecution.count({ where }),
  ]);

  return paginate(
    rows.map((row) => ({
      id: row.id,
      workflow: row.workflow,
      entityType: row.entityType,
      entityId: row.entityId,
      status: row.status,
      steps: row.steps,
      error: row.error,
      depth: row.depth,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    })),
    total,
    query,
  );
}

/** Referenced templates, endpoints and users must exist in this organization. */
async function assertActionTargetsExist(ctx: ActorContext, data: z.infer<typeof workflowInputSchema>) {
  for (const action of data.actions) {
    if (action.type === "send_email") {
      const template = await prisma.emailTemplate.findFirst({ where: { id: action.templateId, ...scope(ctx) } });
      if (!template) throw ValidationError("Die gewählte E-Mail-Vorlage wurde nicht gefunden.");
    }
    if (action.type === "trigger_webhook") {
      const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id: action.endpointId, ...scope(ctx) } });
      if (!endpoint) throw ValidationError("Der gewählte Webhook wurde nicht gefunden.");
    }
    if (action.type === "set_owner" || action.type === "send_notification") {
      const userId = action.type === "set_owner" ? action.ownerId : action.userId;
      const membership = await prisma.membership.findFirst({ where: { userId, ...scope(ctx), status: "ACTIVE" } });
      if (!membership) throw ValidationError("Die gewählte Person ist kein aktives Mitglied dieser Organisation.");
    }
  }
}
