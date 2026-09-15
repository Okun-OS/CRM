import type { CrmObjectType, WorkflowTriggerType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { ActorContext } from "@/lib/context";
import { scope } from "@/lib/tenant";
import { logError, logInfo } from "@/lib/logger";
import { buildWhere, type FilterGroup } from "@/lib/filters";
import { listDefinitions } from "@/lib/properties";
import { findField } from "@/lib/crm/fields";
import { MAX_EVENT_DEPTH, type DomainEvent } from "@/lib/events";
import { actionSchema, triggerConfigSchema, type WorkflowAction } from "./types";

/**
 * Workflow engine.
 *
 * Execution model: a domain event selects candidate workflows, the trigger
 * configuration narrows them further, conditions are evaluated by re-querying
 * the record through the same filter engine the UI uses, and each action runs
 * in order. Every run is written to WorkflowExecution with a per-step log.
 *
 * Loop protection: actions emit events at `depth + 1` and the engine refuses to
 * run beyond MAX_EVENT_DEPTH.
 */
type StepLog = { action: string; status: "ok" | "skipped" | "failed"; detail?: string };

const EVENT_TRIGGERS: Record<string, WorkflowTriggerType | undefined> = {
  "contact.created": "RECORD_CREATED",
  "company.created": "RECORD_CREATED",
  "lead.created": "RECORD_CREATED",
  "deal.created": "RECORD_CREATED",
  "contact.updated": "PROPERTY_CHANGED",
  "company.updated": "PROPERTY_CHANGED",
  "lead.updated": "PROPERTY_CHANGED",
  "deal.updated": "PROPERTY_CHANGED",
  "deal.stage_changed": "DEAL_STAGE_CHANGED",
  "lead.status_changed": "LEAD_STATUS_CHANGED",
};

export async function runWorkflowsForEvent(ctx: ActorContext, event: DomainEvent, depth: number): Promise<void> {
  const triggerType = EVENT_TRIGGERS[event.name];
  if (!triggerType) return;
  if (depth >= MAX_EVENT_DEPTH) return;
  if (!isCrmObject(event.entityType)) return;

  const workflows = await prisma.workflow.findMany({
    where: { ...scope(ctx), isActive: true, objectType: event.entityType, triggerType },
  });
  if (workflows.length === 0) return;

  for (const workflow of workflows) {
    const triggerConfig = triggerConfigSchema.safeParse(workflow.triggerConfig ?? {});
    if (!triggerConfig.success) continue;

    if (!triggerMatches(triggerType, triggerConfig.data, event)) continue;

    const execution = await prisma.workflowExecution.create({
      data: {
        organizationId: ctx.organizationId,
        workflowId: workflow.id,
        entityType: event.entityType,
        entityId: event.entityId,
        status: "RUNNING",
        steps: [],
        depth,
      },
    });

    const steps: StepLog[] = [];
    try {
      const matches = await conditionsMatch(ctx, event.entityType, event.entityId, workflow.conditions as FilterGroup);
      if (!matches) {
        await finish(execution.id, "SKIPPED", [{ action: "conditions", status: "skipped", detail: "Bedingungen nicht erfüllt" }]);
        continue;
      }

      for (const rawAction of (workflow.actions as unknown[]) ?? []) {
        const parsed = actionSchema.safeParse(rawAction);
        if (!parsed.success) {
          steps.push({ action: "unknown", status: "failed", detail: "Ungültige Aktionskonfiguration" });
          continue;
        }
        steps.push(await runAction(ctx, parsed.data, event, depth));
      }

      const failed = steps.some((step) => step.status === "failed");
      await finish(execution.id, failed ? "FAILED" : "SUCCEEDED", steps);
      await prisma.workflow.update({
        where: { id: workflow.id },
        data: { runCount: { increment: 1 }, lastRunAt: new Date() },
      });

      if (failed) await notifyOwnerOfFailure(ctx, workflow.id, workflow.name, workflow.createdById);
      logInfo("workflow.executed", { workflowId: workflow.id, status: failed ? "FAILED" : "SUCCEEDED" });
    } catch (error) {
      logError("workflow.failed", error, { workflowId: workflow.id, entityId: event.entityId });
      await finish(execution.id, "FAILED", steps, error instanceof Error ? error.message : "Unbekannter Fehler");
      await notifyOwnerOfFailure(ctx, workflow.id, workflow.name, workflow.createdById);
    }
  }
}

function isCrmObject(value: string): value is CrmObjectType {
  return value === "CONTACT" || value === "COMPANY" || value === "LEAD" || value === "DEAL";
}

function triggerMatches(
  triggerType: WorkflowTriggerType,
  config: { propertyKey?: string; stageId?: string; statusKey?: string },
  event: DomainEvent,
): boolean {
  switch (triggerType) {
    case "PROPERTY_CHANGED":
      if (!config.propertyKey) return true;
      return (event.changed ?? []).includes(config.propertyKey);
    case "DEAL_STAGE_CHANGED":
      if (!config.stageId) return true;
      return event.payload.toStageId === config.stageId || event.payload.stageId === config.stageId;
    case "LEAD_STATUS_CHANGED":
      if (!config.statusKey) return true;
      return event.payload.status === config.statusKey;
    default:
      return true;
  }
}

/** Conditions are evaluated by re-querying the record with the saved filter. */
async function conditionsMatch(
  ctx: ActorContext,
  objectType: CrmObjectType,
  entityId: string,
  conditions: FilterGroup | null,
): Promise<boolean> {
  if (!conditions || (conditions.conditions?.length ?? 0) + (conditions.groups?.length ?? 0) === 0) return true;

  const definitions = await listDefinitions(ctx, objectType);
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

  const where = buildWhere(conditions, (field) => {
    if (field.startsWith("property:")) {
      const definition = byKey.get(field.slice("property:".length));
      return definition ? { kind: "property" as const, definition } : null;
    }
    const registered = findField(objectType, field);
    if (!registered) return null;
    return { kind: "scalar" as const, path: registered.path ?? registered.key, type: registered.type };
  });

  const delegate = {
    CONTACT: prisma.contact,
    COMPANY: prisma.company,
    LEAD: prisma.lead,
    DEAL: prisma.deal,
  }[objectType];

  const found = await (delegate as { findFirst: (args: unknown) => Promise<{ id: string } | null> }).findFirst({
    where: { id: entityId, ...scope(ctx), deletedAt: null, ...where },
    select: { id: true },
  });
  return found !== null;
}

async function runAction(
  ctx: ActorContext,
  action: WorkflowAction,
  event: DomainEvent,
  depth: number,
): Promise<StepLog> {
  const nextDepth = depth + 1;
  const objectType = event.entityType as CrmObjectType;

  try {
    switch (action.type) {
      case "set_property": {
        const isCustom = action.field.startsWith("property:");
        const payload = isCustom
          ? { properties: { [action.field.slice("property:".length)]: action.value } }
          : { [action.field]: action.value };
        await updateRecord(ctx, objectType, event.entityId, payload, nextDepth);
        return { action: "set_property", status: "ok", detail: `${action.field} = ${String(action.value)}` };
      }
      case "set_owner": {
        await updateRecord(ctx, objectType, event.entityId, { ownerId: action.ownerId }, nextDepth);
        return { action: "set_owner", status: "ok" };
      }
      case "create_task": {
        const { createTaskFromAutomation } = await import("@/server/services/tasks");
        const owner = action.assignToOwner ? await recordOwnerId(objectType, event.entityId, ctx) : undefined;
        await createTaskFromAutomation(ctx, {
          title: action.title,
          description: action.description,
          dueInDays: action.dueInDays,
          priority: action.priority,
          ownerId: owner ?? undefined,
          ...linkFor(objectType, event.entityId),
        });
        return { action: "create_task", status: "ok", detail: action.title };
      }
      case "create_note": {
        const { createNote } = await import("@/server/services/notes");
        await createNote(ctx, { body: action.body, ...linkFor(objectType, event.entityId) });
        return { action: "create_note", status: "ok" };
      }
      case "send_notification": {
        const { notify } = await import("@/server/services/notifications");
        await notify(ctx, {
          userId: action.userId,
          type: "MENTION",
          title: action.title,
          body: action.body,
          entityType: objectType,
          entityId: event.entityId,
        });
        return { action: "send_notification", status: "ok" };
      }
      case "send_email": {
        const { sendTemplatedEmailForAutomation } = await import("@/server/services/emails");
        const result = await sendTemplatedEmailForAutomation(ctx, {
          templateId: action.templateId,
          objectType,
          entityId: event.entityId,
          toField: action.toField,
        });
        return { action: "send_email", status: result.sent ? "ok" : "skipped", detail: result.reason };
      }
      case "trigger_webhook": {
        const { queueWebhookDelivery } = await import("@/server/services/webhooks");
        await queueWebhookDelivery(ctx, action.endpointId, event);
        return { action: "trigger_webhook", status: "ok" };
      }
      default:
        return { action: "unknown", status: "failed", detail: "Unbekannter Aktionstyp" };
    }
  } catch (error) {
    return {
      action: action.type,
      status: "failed",
      detail: error instanceof Error ? error.message : "Unbekannter Fehler",
    };
  }
}

function linkFor(objectType: CrmObjectType, entityId: string) {
  switch (objectType) {
    case "CONTACT":
      return { contactId: entityId };
    case "COMPANY":
      return { companyId: entityId };
    case "LEAD":
      return { leadId: entityId };
    case "DEAL":
      return { dealId: entityId };
  }
}

async function recordOwnerId(objectType: CrmObjectType, entityId: string, ctx: ActorContext) {
  const delegate = {
    CONTACT: prisma.contact,
    COMPANY: prisma.company,
    LEAD: prisma.lead,
    DEAL: prisma.deal,
  }[objectType];
  const record = await (delegate as { findFirst: (args: unknown) => Promise<{ ownerId: string | null } | null> }).findFirst({
    where: { id: entityId, ...scope(ctx) },
    select: { ownerId: true },
  });
  return record?.ownerId ?? null;
}

async function updateRecord(
  ctx: ActorContext,
  objectType: CrmObjectType,
  entityId: string,
  payload: Record<string, unknown>,
  depth: number,
) {
  switch (objectType) {
    case "CONTACT": {
      const { updateContact } = await import("@/server/services/contacts");
      await updateContact(ctx, entityId, payload, { depth });
      return;
    }
    case "COMPANY": {
      const { updateCompany } = await import("@/server/services/companies");
      await updateCompany(ctx, entityId, payload, { depth });
      return;
    }
    case "LEAD": {
      const { updateLead } = await import("@/server/services/leads");
      await updateLead(ctx, entityId, payload, { depth });
      return;
    }
    case "DEAL": {
      const { updateDeal } = await import("@/server/services/deals");
      await updateDeal(ctx, entityId, payload, { depth });
      return;
    }
  }
}

async function finish(executionId: string, status: "SUCCEEDED" | "FAILED" | "SKIPPED", steps: StepLog[], error?: string) {
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { status, steps: steps as never, finishedAt: new Date(), error },
  });
}

async function notifyOwnerOfFailure(ctx: ActorContext, workflowId: string, name: string, createdById: string | null) {
  if (!createdById) return;
  const { notify } = await import("@/server/services/notifications");
  await notify(ctx, {
    userId: createdById,
    type: "WORKFLOW_FAILED",
    title: `Workflow fehlgeschlagen: ${name}`,
    body: "Mindestens eine Aktion konnte nicht ausgeführt werden.",
    link: `/workflows/${workflowId}`,
    entityType: "Workflow",
    entityId: workflowId,
  });
}
