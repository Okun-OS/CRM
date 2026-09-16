import { prisma } from "./db";
import type { ActorContext } from "./context";
import { logError } from "./logger";
import type { DomainEventName } from "./domain-events";

/**
 * Domain events are the single fan-out point for everything that reacts to a
 * change: workflow automation and outgoing webhooks. Timeline activities are
 * written by the services themselves, because they need the record's own
 * transaction.
 *
 * Reactions never fail the originating request; failures are logged (and, for
 * workflows, recorded as a failed execution).
 */
export { DOMAIN_EVENTS, type DomainEventName } from "./domain-events";

export type DomainEvent = {
  name: DomainEventName;
  entityType: "CONTACT" | "COMPANY" | "LEAD" | "DEAL" | "TASK" | "MEETING";
  entityId: string;
  payload: Record<string, unknown>;
  /** Fields that changed, for PROPERTY_CHANGED workflow triggers. */
  changed?: string[];
  /** Automation recursion depth; guards against workflow loops. */
  depth?: number;
};

export const MAX_EVENT_DEPTH = 3;

export async function emitDomainEvent(ctx: ActorContext, event: DomainEvent): Promise<void> {
  const depth = event.depth ?? 0;

  await Promise.allSettled([
    runWorkflows(ctx, event, depth),
    dispatchWebhooks(ctx, event),
    feedEngine(ctx, event),
  ]);
}

async function runWorkflows(ctx: ActorContext, event: DomainEvent, depth: number) {
  if (depth >= MAX_EVENT_DEPTH) return;
  try {
    // Imported lazily: the workflow engine calls back into services that emit events.
    const { runWorkflowsForEvent } = await import("@/server/workflows/engine");
    await runWorkflowsForEvent(ctx, event, depth);
  } catch (error) {
    logError("workflow.dispatch_failed", error, { event: event.name, entityId: event.entityId });
  }
}

/** Feeds the Active CRM engine; a failure here never breaks the request. */
async function feedEngine(ctx: ActorContext, event: DomainEvent) {
  try {
    const { bridgeToEngine } = await import("@/server/engine/bridge");
    await bridgeToEngine(ctx, event);
  } catch (error) {
    logError("engine.bridge_failed", error, { event: event.name, entityId: event.entityId });
  }
}

async function dispatchWebhooks(ctx: ActorContext, event: DomainEvent) {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { organizationId: ctx.organizationId, isActive: true, events: { has: event.name } },
      select: { id: true },
    });
    if (endpoints.length === 0) return;
    const { queueWebhookDelivery } = await import("@/server/services/webhooks");
    await Promise.allSettled(
      endpoints.map((endpoint) => queueWebhookDelivery(ctx, endpoint.id, event)),
    );
  } catch (error) {
    logError("webhook.dispatch_failed", error, { event: event.name });
  }
}
