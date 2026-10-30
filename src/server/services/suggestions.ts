import { prisma } from "@/lib/db";
import { assertPermission, type ActorContext } from "@/lib/context";
import { assertFound, liveScope, scope } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { Conflict, ValidationError } from "@/lib/api/errors";
import { changeDealStage } from "./deals";
import { updateContact } from "./contacts";
import { setManualNextAction } from "./next-actions";
import { logSystemActivity } from "./activities";
import { notify } from "./notifications";

/**
 * Vorschläge zur Bestätigung.
 *
 * Eine Integration (heute Mailwin) darf erkennen und vorschlagen — „Der Kunde
 * hat das Angebot angenommen, als gewonnen markieren?“. Was am Ende in
 * Forecast und Stammdaten steht, entscheidet ein Mensch mit einem Klick.
 * Ein Vorschlag an einem Deal wird zugleich dessen nächste Aktion, damit er in
 * „Heute“ auftaucht und nicht in einer Akte versandet.
 */
export type SuggestionKind = "deal.mark_won" | "deal.mark_lost" | "contact.update";

export type SuggestionEvidence = { quote?: string; confidence?: number; url?: string };

export type SuggestionDTO = {
  id: string;
  source: string;
  kind: SuggestionKind;
  title: string;
  reason: string;
  payload: Record<string, unknown>;
  evidence: SuggestionEvidence | null;
  createdAt: string;
};

function toDTO(row: {
  id: string;
  source: string;
  kind: string;
  title: string;
  reason: string;
  payload: unknown;
  evidence: unknown;
  createdAt: Date;
}): SuggestionDTO {
  return {
    id: row.id,
    source: row.source,
    kind: row.kind as SuggestionKind,
    title: row.title,
    reason: row.reason,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    evidence: (row.evidence ?? null) as SuggestionEvidence | null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createSuggestion(
  ctx: ActorContext,
  input: {
    source: string;
    kind: SuggestionKind;
    dealId?: string | null;
    contactId?: string | null;
    title: string;
    reason: string;
    payload: Record<string, unknown>;
    evidence?: SuggestionEvidence | null;
  },
): Promise<SuggestionDTO> {
  const suggestion = await prisma.recordSuggestion.create({
    data: {
      organizationId: ctx.organizationId,
      source: input.source,
      kind: input.kind,
      dealId: input.dealId ?? null,
      contactId: input.contactId ?? null,
      title: input.title,
      reason: input.reason,
      payload: input.payload as never,
      evidence: (input.evidence ?? undefined) as never,
    },
  });

  if (input.dealId) {
    const deal = await prisma.deal.findFirst({ where: { id: input.dealId, ...scope(ctx) }, select: { ownerId: true, name: true } });
    const state = await setManualNextAction(
      ctx,
      { kind: "DEAL", id: input.dealId },
      { type: "GET_DECISION", title: input.title, reason: input.reason, dueAt: new Date(), ownerId: deal?.ownerId ?? undefined },
    );
    const nextActionId = state.current?.id ?? null;
    if (nextActionId) {
      await prisma.recordSuggestion.update({ where: { id: suggestion.id }, data: { nextActionId } });
    }
  } else if (input.contactId) {
    const contact = await prisma.contact.findFirst({ where: { id: input.contactId, ...scope(ctx) }, select: { ownerId: true } });
    if (contact?.ownerId) {
      await notify(ctx, {
        userId: contact.ownerId,
        type: "MENTION",
        title: input.title,
        body: input.reason,
        link: `/contacts/${input.contactId}`,
        entityType: "Contact",
        entityId: input.contactId,
      });
    }
  }

  await writeAudit(ctx, {
    action: "suggestion.created",
    entityType: "RecordSuggestion",
    entityId: suggestion.id,
    after: { kind: input.kind, dealId: input.dealId ?? null, contactId: input.contactId ?? null, title: input.title },
  });
  return toDTO(suggestion);
}

export async function listPendingSuggestions(
  ctx: ActorContext,
  target: { dealId?: string; contactId?: string },
): Promise<SuggestionDTO[]> {
  if (target.dealId) assertPermission(ctx, "deals.read");
  if (target.contactId) assertPermission(ctx, "contacts.read");
  const rows = await prisma.recordSuggestion.findMany({
    where: { ...scope(ctx), status: "PENDING", ...(target.dealId ? { dealId: target.dealId } : {}), ...(target.contactId ? { contactId: target.contactId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return rows.map(toDTO);
}

async function loadPending(ctx: ActorContext, id: string) {
  const suggestion = assertFound(
    await prisma.recordSuggestion.findFirst({ where: { id, ...scope(ctx) } }),
    "Der Vorschlag wurde nicht gefunden.",
  );
  if (suggestion.status !== "PENDING") throw Conflict("Über diesen Vorschlag wurde bereits entschieden.");
  assertPermission(ctx, suggestion.dealId ? "deals.write" : "contacts.write");
  return suggestion;
}

/** Führt den Vorschlag aus — über dieselben Services wie eine Eingabe von Hand. */
export async function acceptSuggestion(ctx: ActorContext, id: string): Promise<{ status: "ACCEPTED" }> {
  const suggestion = await loadPending(ctx, id);
  const payload = (suggestion.payload ?? {}) as Record<string, unknown>;

  if (suggestion.kind === "deal.mark_won" || suggestion.kind === "deal.mark_lost") {
    const deal = assertFound(
      await prisma.deal.findFirst({ where: { id: suggestion.dealId ?? "", ...liveScope(ctx) }, select: { id: true, pipelineId: true, status: true } }),
      "Der Deal wurde nicht gefunden.",
    );
    if (deal.status === "OPEN") {
      const type = suggestion.kind === "deal.mark_won" ? "WON" : "LOST";
      const stage = await prisma.pipelineStage.findFirst({
        where: { pipelineId: deal.pipelineId, ...scope(ctx), type },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      if (!stage) throw ValidationError(`Die Pipeline hat keine Phase vom Typ „${type === "WON" ? "Gewonnen" : "Verloren"}“.`);
      await changeDealStage(ctx, deal.id, {
        stageId: stage.id,
        lostReason: type === "LOST" && typeof payload.lostReason === "string" ? payload.lostReason : undefined,
      });
    }
  } else if (suggestion.kind === "contact.update") {
    const fields = (payload.fields ?? {}) as Record<string, string>;
    await updateContact(ctx, suggestion.contactId ?? "", fields);
  } else {
    throw ValidationError("Unbekannter Vorschlag.");
  }

  await decide(ctx, suggestion, "ACCEPTED");
  return { status: "ACCEPTED" };
}

export async function rejectSuggestion(ctx: ActorContext, id: string): Promise<{ status: "REJECTED" }> {
  const suggestion = await loadPending(ctx, id);
  await decide(ctx, suggestion, "REJECTED");
  if (suggestion.dealId) {
    await logSystemActivity(ctx, {
      subject: `Vorschlag verworfen: ${suggestion.title}`,
      links: { dealId: suggestion.dealId },
    });
  }
  return { status: "REJECTED" };
}

async function decide(
  ctx: ActorContext,
  suggestion: { id: string; dealId: string | null; nextActionId: string | null; title: string },
  status: "ACCEPTED" | "REJECTED",
) {
  await prisma.recordSuggestion.update({
    where: { id: suggestion.id },
    data: { status, decidedAt: new Date(), decidedById: ctx.userId },
  });
  // Die nächste Aktion „Zusage prüfen“ ist mit der Entscheidung erledigt.
  if (suggestion.nextActionId) {
    await prisma.nextAction.updateMany({
      where: { id: suggestion.nextActionId, ...scope(ctx), status: { in: ["OPEN", "SNOOZED"] } },
      data: status === "ACCEPTED"
        ? { status: "DONE", completedAt: new Date(), completedById: ctx.userId }
        : { status: "DISMISSED", dismissedAt: new Date(), dismissReason: "Vorschlag verworfen" },
    });
    if (suggestion.dealId) {
      const { reconcileSafely } = await import("@/server/engine/next-actions");
      await reconcileSafely(ctx.organizationId, { kind: "DEAL", id: suggestion.dealId });
    }
  }
  await writeAudit(ctx, {
    action: status === "ACCEPTED" ? "suggestion.accepted" : "suggestion.rejected",
    entityType: "RecordSuggestion",
    entityId: suggestion.id,
    after: { title: suggestion.title },
  });
}
