import { prisma } from "@/lib/db";
import type { AutomationGuard } from "./guards";
import { scheduleAutomation } from "./automations";
import type { EngineSubject, EngineThresholds, NextActionProposal } from "./types";
import type { SubjectRef } from "./subject";

/**
 * Turning a proposal into something the system actually does.
 *
 * Only rules listed here are automated, and what they schedule is an internal
 * reminder for the owner — never an outbound message the user did not ask for.
 * Sending something to a customer automatically stays an explicit decision
 * (an e-mail automation with a template), because a wrong automated message
 * costs more than a missed reminder.
 */
type FollowUpSpec = {
  /** Guards evaluated again immediately before the reminder is created. */
  guards: (subject: EngineSubject, now: Date) => AutomationGuard[];
};

const ALWAYS: AutomationGuard[] = [{ kind: "record_open" }, { kind: "automation_not_paused" }];

const AUTOMATABLE: Record<string, FollowUpSpec> = {
  "outbound.follow_up": {
    guards: (subject) => [
      ...ALWAYS,
      { kind: "no_customer_response_since", since: (subject.lastOutboundAt ?? subject.createdAt).toISOString() },
      { kind: "no_outbound_since", since: (subject.lastOutboundAt ?? subject.createdAt).toISOString() },
      { kind: "no_meeting_scheduled" },
    ],
  },
  "offer.chase": {
    guards: (subject) => [
      ...ALWAYS,
      { kind: "no_customer_response_since", since: (subject.offerSentAt ?? subject.createdAt).toISOString() },
      { kind: "no_outbound_since", since: (subject.offerSentAt ?? subject.createdAt).toISOString() },
    ],
  },
  "lead.first_contact": {
    guards: (subject) => [...ALWAYS, { kind: "no_outbound_since", since: subject.createdAt.toISOString() }],
  },
  "meeting.follow_up": {
    guards: (subject) => [
      ...ALWAYS,
      { kind: "no_outbound_since", since: (subject.meetingCompletedAt ?? subject.createdAt).toISOString() },
      { kind: "no_meeting_scheduled" },
    ],
  },
  "stagnation.reactivate": {
    guards: (subject, now) => [...ALWAYS, { kind: "no_outbound_since", since: now.toISOString() }],
  },
};

const PREFIX = "engine:";

/**
 * Keeps the scheduled reminders in step with the current proposal: what no
 * longer matches is cancelled with a reason, what is missing is scheduled.
 */
export async function syncFollowUpAutomation(
  organizationId: string,
  ref: SubjectRef,
  subject: EngineSubject,
  proposal: NextActionProposal,
  config: EngineThresholds,
  now: Date,
): Promise<void> {
  const where = ref.kind === "DEAL" ? { dealId: ref.id } : { leadId: ref.id };
  const wanted = `${PREFIX}${proposal.ruleKey}`;

  await prisma.scheduledAutomation.updateMany({
    where: {
      organizationId,
      ...where,
      status: "PENDING",
      ruleKey: { startsWith: PREFIX, not: wanted },
    },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      outcomeReason: "Die nächste Aktion hat sich geändert.",
    },
  });

  const spec = AUTOMATABLE[proposal.ruleKey];
  if (!spec || !config.automationEnabled || !proposal.dueAt) return;
  if (subject.automationPausedUntil && subject.automationPausedUntil.getTime() > now.getTime()) return;
  // An owner who already has an open task for this record needs no second one.
  if (subject.openTaskCount > 0) return;

  await scheduleAutomation(organizationId, ref, {
    type: "FOLLOW_UP_TASK",
    scheduledFor: proposal.dueAt,
    reason: proposal.reason,
    dedupeKey: wanted,
    guards: spec.guards(subject, now),
    ownerId: subject.ownerId,
    payload: { nextActionType: proposal.type, title: proposal.title },
  });
}
