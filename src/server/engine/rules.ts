import { PRIORITY } from "@/lib/crm/active";
import type { EngineSubject, EngineThresholds, NextActionProposal, Rule } from "./types";

/**
 * The rule catalogue.
 *
 * Rules are evaluated top to bottom, the first match wins. Each one is a pure
 * function of the record snapshot and the organization's thresholds, so every
 * proposal can be explained by naming the rule and its reason — there is no
 * scoring model and no hidden heuristic behind any of this.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY);
}

/**
 * True when the customer spoke last and we still owe an answer.
 *
 * Timestamps decide as long as they differ. They often do not: an activity
 * logged by hand carries the minute it was entered, so a reply and the message
 * it answers can share a timestamp. In that case the order in which the events
 * were recorded settles it.
 */
function customerIsWaitingForUs(subject: EngineSubject): boolean {
  if (!subject.lastCustomerResponseAt) return false;
  if (!subject.lastOutboundAt) return true;

  const difference = subject.lastCustomerResponseAt.getTime() - subject.lastOutboundAt.getTime();
  if (difference !== 0) return difference > 0;
  return subject.lastEngagementInbound === true;
}

const respondToCustomer: Rule = {
  key: "customer_replied.respond",
  label: "Kundenantwort beantworten",
  appliesTo: ["DEAL", "LEAD"],
  evaluate(subject) {
    if (!customerIsWaitingForUs(subject)) return null;
    return {
      ruleKey: "customer_replied.respond",
      type: "FOLLOW_UP",
      title: "Auf Kundenantwort reagieren",
      reason: `Der Kunde hat am ${formatDate(subject.lastCustomerResponseAt as Date)} geantwortet, eine Reaktion von uns steht aus.`,
      dueAt: subject.lastCustomerResponseAt,
      priority: PRIORITY.CRITICAL,
      operationalState: "WAITING_FOR_US",
    };
  },
};

const recall: Rule = {
  key: "recall.due",
  label: "Wiedervorlage",
  appliesTo: ["DEAL", "LEAD"],
  evaluate(subject) {
    if (!subject.recallAt) return null;
    return {
      ruleKey: "recall.due",
      type: "FOLLOW_UP",
      title: "Wiedervorlage: erneut melden",
      reason: `Für den ${formatDate(subject.recallAt)} wurde eine Wiedervorlage vereinbart.`,
      dueAt: subject.recallAt,
      priority: PRIORITY.HIGH,
      operationalState: "SCHEDULED",
    };
  },
};

const prepareMeeting: Rule = {
  key: "meeting.prepare",
  label: "Anstehenden Termin vorbereiten",
  appliesTo: ["DEAL", "LEAD"],
  evaluate(subject, config, now) {
    if (!subject.nextMeetingAt || subject.nextMeetingAt.getTime() <= now.getTime()) return null;
    const dueAt = addHours(subject.nextMeetingAt, -config.meetingPrepLeadHours);
    return {
      ruleKey: "meeting.prepare",
      type: "PREPARE_MEETING",
      title: "Termin vorbereiten",
      reason: `Am ${formatDate(subject.nextMeetingAt)} findet ein Termin statt.`,
      dueAt,
      priority: PRIORITY.NORMAL,
      operationalState: "SCHEDULED",
    };
  },
};

const meetingFollowUp: Rule = {
  key: "meeting.follow_up",
  label: "Nach dem Termin nächsten Schritt festlegen",
  appliesTo: ["DEAL", "LEAD"],
  evaluate(subject, config) {
    const held = subject.meetingCompletedAt;
    if (!held) return null;
    // Anything we did after the meeting already answers this rule.
    if (subject.lastOutboundAt && subject.lastOutboundAt.getTime() > held.getTime()) return null;
    if (subject.offerSentAt && subject.offerSentAt.getTime() > held.getTime()) return null;
    return {
      ruleKey: "meeting.follow_up",
      type: "DEFINE_NEXT_STEP",
      title: "Nächsten Schritt nach dem Termin festlegen",
      reason: `Der Termin vom ${formatDate(held)} hat stattgefunden, seitdem ist nichts passiert.`,
      dueAt: addDays(held, config.meetingFollowUpDays),
      priority: PRIORITY.HIGH,
      operationalState: "WAITING_FOR_US",
    };
  },
};

const chaseOffer: Rule = {
  key: "offer.chase",
  label: "Angebot nachfassen",
  appliesTo: ["DEAL"],
  evaluate(subject, config) {
    if (!subject.offerSentAt) return null;
    if (subject.lastCustomerResponseAt && subject.lastCustomerResponseAt.getTime() > subject.offerSentAt.getTime()) {
      return null;
    }
    return {
      ruleKey: "offer.chase",
      type: "CHASE_OFFER",
      title: "Angebot nachfassen",
      reason: `Das Angebot wurde am ${formatDate(subject.offerSentAt)} gesendet, eine Rückmeldung steht aus.`,
      dueAt: addDays(subject.offerSentAt, config.offerChaseAfterDays),
      priority: PRIORITY.HIGH,
      operationalState: "WAITING_FOR_CUSTOMER",
    };
  },
};

const contactNewLead: Rule = {
  key: "lead.first_contact",
  label: "Neuen Lead kontaktieren",
  appliesTo: ["LEAD"],
  evaluate(subject, config) {
    if (subject.lastOutboundAt) return null;
    return {
      ruleKey: "lead.first_contact",
      type: "CONTACT_LEAD",
      title: "Lead erstmalig kontaktieren",
      reason: `Der Lead ist seit dem ${formatDate(subject.createdAt)} im System und wurde noch nicht kontaktiert.`,
      dueAt: addHours(subject.createdAt, config.leadContactWithinHours),
      priority: PRIORITY.HIGH,
      operationalState: "WAITING_FOR_US",
    };
  },
};

const qualifyLead: Rule = {
  key: "lead.qualify",
  label: "Antwortenden Lead qualifizieren",
  appliesTo: ["LEAD"],
  evaluate(subject) {
    if (!subject.lastCustomerResponseAt) return null;
    return {
      ruleKey: "lead.qualify",
      type: "QUALIFY_LEAD",
      title: "Lead qualifizieren",
      reason: `Der Lead hat am ${formatDate(subject.lastCustomerResponseAt)} reagiert und ist noch nicht qualifiziert.`,
      dueAt: subject.lastCustomerResponseAt,
      priority: PRIORITY.HIGH,
      operationalState: "WAITING_FOR_US",
    };
  },
};

/**
 * What the pipeline stage itself declares. This is the configurable hook: an
 * administrator sets "a deal in this stage waits for an offer, within 5 days"
 * and the engine proposes exactly that.
 */
const stageExpectation: Rule = {
  key: "stage.expected_action",
  label: "Von der Stage erwartete Aktion",
  appliesTo: ["DEAL"],
  evaluate(subject) {
    if (!subject.stageExpectedAction) return null;
    const since = subject.stageEnteredAt ?? subject.createdAt;
    const days = subject.stageExpectedActionDays ?? 0;
    return {
      ruleKey: "stage.expected_action",
      type: subject.stageExpectedAction,
      title: `Nächster Schritt in „${subject.stageName ?? "dieser Stage"}“`,
      reason: `Für die Stage „${subject.stageName ?? "–"}“ ist dieser Schritt hinterlegt; der Deal ist seit dem ${formatDate(since)} darin.`,
      dueAt: addDays(since, days),
      priority: PRIORITY.NORMAL,
      operationalState: "WAITING_FOR_US",
    };
  },
};

const followUpOutbound: Rule = {
  key: "outbound.follow_up",
  label: "Nachfassen ohne Antwort",
  appliesTo: ["DEAL", "LEAD"],
  evaluate(subject, config) {
    if (!subject.lastOutboundAt) return null;
    return {
      ruleKey: "outbound.follow_up",
      type: "FOLLOW_UP",
      title: "Nachfassen",
      reason: `Unsere letzte Nachricht ging am ${formatDate(subject.lastOutboundAt)} raus, eine Antwort steht aus.`,
      dueAt: addDays(subject.lastOutboundAt, config.followUpAfterDays),
      priority: PRIORITY.NORMAL,
      operationalState: "WAITING_FOR_CUSTOMER",
    };
  },
};

const reactivate: Rule = {
  key: "stagnation.reactivate",
  label: "Stagnierenden Datensatz reaktivieren",
  appliesTo: ["DEAL", "LEAD"],
  evaluate(subject, config, now) {
    const last = subject.lastActivityAt ?? subject.createdAt;
    const idle = daysBetween(last, now);
    if (idle < config.stagnationAfterDays) return null;
    return {
      ruleKey: "stagnation.reactivate",
      type: "REACTIVATE",
      title: "Reaktivieren oder abschließen",
      reason: `Seit ${idle} Tagen ist nichts passiert (letzte Aktivität am ${formatDate(last)}).`,
      dueAt: addDays(last, config.stagnationAfterDays),
      priority: PRIORITY.HIGH,
      operationalState: "WAITING_FOR_US",
    };
  },
};

/**
 * The guarantee: an open record never ends up without a traceable next step.
 * This rule matches unconditionally and is therefore always last.
 */
const defineNextStep: Rule = {
  key: "fallback.define_next_step",
  label: "Keine nächste Aktion definiert",
  appliesTo: ["DEAL", "LEAD"],
  evaluate() {
    return {
      ruleKey: "fallback.define_next_step",
      type: "DEFINE_NEXT_STEP",
      title: "Keine nächste Aktion definiert",
      reason: "Für diesen offenen Datensatz ist kein nächster Schritt hinterlegt.",
      dueAt: null,
      priority: PRIORITY.HIGH,
      operationalState: "NO_NEXT_ACTION",
    };
  },
};

/** Evaluation order — the decision table of the engine. */
export const RULES: Rule[] = [
  respondToCustomer,
  recall,
  prepareMeeting,
  meetingFollowUp,
  chaseOffer,
  qualifyLead,
  contactNewLead,
  stageExpectation,
  followUpOutbound,
  reactivate,
  defineNextStep,
];

export const RULE_CATALOGUE = RULES.map((rule) => ({
  key: rule.key,
  label: rule.label,
  appliesTo: rule.appliesTo,
}));

export type RuleEvaluation = {
  proposal: NextActionProposal;
  /** Rules that were checked and did not match — the audit trail of a decision. */
  skipped: string[];
};

/**
 * Runs the catalogue for one subject. Disabled rules are skipped, and the
 * organization's overrides are applied to the winning proposal.
 */
export function evaluateRules(
  subject: EngineSubject,
  config: EngineThresholds,
  overrides: Record<string, { isEnabled: boolean; delayDays: number | null; priority: number | null }>,
  now: Date,
): RuleEvaluation {
  const skipped: string[] = [];

  for (const rule of RULES) {
    if (!rule.appliesTo.includes(subject.kind)) continue;
    const override = overrides[rule.key];
    if (override && !override.isEnabled) {
      skipped.push(`${rule.key} (deaktiviert)`);
      continue;
    }

    const proposal = rule.evaluate(subject, config, now);
    if (!proposal) {
      skipped.push(rule.key);
      continue;
    }

    return {
      proposal: {
        ...proposal,
        dueAt:
          override?.delayDays != null && proposal.dueAt
            ? addDays(proposal.dueAt, override.delayDays)
            : proposal.dueAt,
        priority: override?.priority ?? proposal.priority,
      },
      skipped,
    };
  }

  // Unreachable: the fallback rule matches everything. Kept explicit so a
  // future change to the catalogue cannot silently drop the guarantee.
  return { proposal: defineNextStep.evaluate(subject, config, now) as NextActionProposal, skipped };
}
