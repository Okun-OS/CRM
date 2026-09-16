import { prisma } from "@/lib/db";
import { logError } from "@/lib/logger";
import { notify } from "@/server/services/notifications";
import { loadEngineConfig } from "./settings";
import { reconcileSubject } from "./next-actions";
import { runDueAutomations } from "./automations";
import { systemContextFor } from "./system-context";
import type { SubjectRef } from "./subject";

/**
 * The periodic pass.
 *
 * Most state changes are event-driven, but two things only become true with
 * the passage of time: a due date arrives, and a record goes quiet. The sweep
 * covers exactly those — it reconciles records whose next action has come due
 * or whose last activity is older than the stagnation threshold, warns the
 * owner about newly stalled records, and executes what is due.
 */
export type SweepResult = {
  organizationId: string;
  reconciled: number;
  stalled: number;
  automations: { executed: number; skipped: number; deferred: number; failed: number };
};

const DAY = 24 * 60 * 60 * 1000;
const BATCH = 200;

export async function runSweepForOrganization(organizationId: string, now = new Date()): Promise<SweepResult> {
  const config = await loadEngineConfig(organizationId);
  const staleBefore = new Date(now.getTime() - config.thresholds.stagnationAfterDays * DAY);

  const [deals, leads] = await Promise.all([
    prisma.deal.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: "OPEN",
        OR: [
          { nextActionAt: { lte: now } },
          { nextActionAt: null },
          { lastActivityAt: { lte: staleBefore } },
          { lastActivityAt: null },
        ],
      },
      select: { id: true, name: true, ownerId: true, momentum: true },
      take: BATCH,
    }),
    prisma.lead.findMany({
      where: {
        organizationId,
        deletedAt: null,
        convertedAt: null,
        OR: [
          { nextActionAt: { lte: now } },
          { nextActionAt: null },
          { lastActivityAt: { lte: staleBefore } },
          { lastActivityAt: null },
        ],
      },
      select: { id: true, firstName: true, lastName: true, companyName: true, ownerId: true, momentum: true },
      take: BATCH,
    }),
  ]);

  let reconciled = 0;
  let stalled = 0;
  const newlyStalled: { ref: SubjectRef; label: string; ownerId: string | null }[] = [];

  for (const deal of deals) {
    const result = await safeReconcile(organizationId, { kind: "DEAL", id: deal.id }, now);
    if (!result) continue;
    reconciled += 1;
    const after = await prisma.deal.findUnique({ where: { id: deal.id }, select: { momentum: true } });
    if (after?.momentum === "STALLED") {
      stalled += 1;
      if (deal.momentum !== "STALLED") {
        newlyStalled.push({ ref: { kind: "DEAL", id: deal.id }, label: deal.name, ownerId: deal.ownerId });
      }
    }
  }

  for (const lead of leads) {
    const result = await safeReconcile(organizationId, { kind: "LEAD", id: lead.id }, now);
    if (!result) continue;
    reconciled += 1;
    const after = await prisma.lead.findUnique({ where: { id: lead.id }, select: { momentum: true } });
    if (after?.momentum === "STALLED") {
      stalled += 1;
      if (lead.momentum !== "STALLED") {
        const label = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.companyName || "Lead";
        newlyStalled.push({ ref: { kind: "LEAD", id: lead.id }, label, ownerId: lead.ownerId });
      }
    }
  }

  await warnOwners(organizationId, newlyStalled, config.thresholds.stagnationAfterDays);

  const outcomes = await runDueAutomations({ organizationId, now });
  return {
    organizationId,
    reconciled,
    stalled,
    automations: {
      executed: outcomes.filter((outcome) => outcome.status === "EXECUTED").length,
      skipped: outcomes.filter((outcome) => outcome.status === "SKIPPED" || outcome.status === "CANCELLED").length,
      deferred: outcomes.filter((outcome) => outcome.status === "DEFERRED").length,
      failed: outcomes.filter((outcome) => outcome.status === "FAILED").length,
    },
  };
}

async function safeReconcile(organizationId: string, ref: SubjectRef, now: Date) {
  try {
    return await reconcileSubject(organizationId, ref, { now });
  } catch (error) {
    logError("engine.sweep_reconcile_failed", error, { kind: ref.kind, id: ref.id });
    return null;
  }
}

/** A stalled record is worth one explicit warning, not a daily reminder. */
async function warnOwners(
  organizationId: string,
  records: { ref: SubjectRef; label: string; ownerId: string | null }[],
  days: number,
): Promise<void> {
  const withOwner = records.filter((record) => record.ownerId);
  if (withOwner.length === 0) return;

  const ctx = await systemContextFor(organizationId, withOwner.map((record) => record.ownerId));
  if (!ctx) return;

  for (const record of withOwner) {
    await notify(ctx, {
      userId: record.ownerId as string,
      type: "TASK_DUE",
      title: `Stagnation erkannt: ${record.label}`,
      body: `Seit mehr als ${days} Tagen ist nichts passiert. Empfehlung: reaktivieren oder bewusst abschließen.`,
      link: record.ref.kind === "DEAL" ? `/deals/${record.ref.id}` : `/leads/${record.ref.id}`,
      entityType: record.ref.kind === "DEAL" ? "Deal" : "Lead",
      entityId: record.ref.id,
    });
  }
}

/** Sweeps every organization — the entry point of the scheduler. */
export async function runSweep(now = new Date()): Promise<SweepResult[]> {
  const organizations = await prisma.organization.findMany({ select: { id: true } });
  const results: SweepResult[] = [];
  for (const organization of organizations) {
    try {
      results.push(await runSweepForOrganization(organization.id, now));
    } catch (error) {
      logError("engine.sweep_failed", error, { organizationId: organization.id });
    }
  }
  return results;
}
