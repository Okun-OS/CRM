import type { Momentum, NextActionType, OperationalState } from "@/generated/prisma/enums";

/**
 * The Next Action engine works on a *snapshot* of a record, never on the record
 * itself. Rules are pure functions of this snapshot, which makes every proposal
 * reproducible and testable without a database.
 */
export type SubjectKind = "DEAL" | "LEAD";

export type EngineSubject = {
  kind: SubjectKind;
  id: string;
  organizationId: string;
  label: string;
  ownerId: string | null;
  contactId: string | null;
  companyId: string | null;

  /** Closed records (won, lost, converted) leave the engine alone. */
  isOpen: boolean;
  createdAt: Date;

  /** Timestamps the engine reasons about. Null means "never happened". */
  stageEnteredAt: Date | null;
  lastActivityAt: Date | null;
  lastOutboundAt: Date | null;
  lastCustomerResponseAt: Date | null;
  nextMeetingAt: Date | null;
  meetingCompletedAt: Date | null;
  /**
   * Whether the most recently recorded engagement was inbound. Manually logged
   * activities often share a timestamp to the minute, so comparing the two
   * timestamps alone cannot say who is at bat — the event order can.
   */
  lastEngagementInbound: boolean | null;
  offerSentAt: Date | null;
  expectedCloseDate: Date | null;
  recallAt: Date | null;

  /** What the pipeline stage itself declares (admin-configurable). */
  stageName: string | null;
  stageExpectedAction: NextActionType | null;
  stageExpectedActionDays: number | null;

  /** Open work already on the record. */
  openTaskDueAt: Date | null;
  openTaskCount: number;

  /** A manual next action wins over every rule. */
  manualAction: {
    id: string;
    type: NextActionType;
    title: string;
    reason: string;
    dueAt: Date | null;
    priority: number;
    ownerId: string | null;
    snoozedUntil: Date | null;
  } | null;

  automationPausedUntil: Date | null;
};

/** What a rule proposes. `dueAt` is absolute so the caller can sort by it. */
export type NextActionProposal = {
  ruleKey: string;
  type: NextActionType;
  title: string;
  /** Always shown to the user — a proposal without a reason is not allowed. */
  reason: string;
  dueAt: Date | null;
  priority: number;
  operationalState: OperationalState;
};

export type EngineThresholds = {
  automationEnabled: boolean;
  leadContactWithinHours: number;
  followUpAfterDays: number;
  offerChaseAfterDays: number;
  stagnationAfterDays: number;
  meetingPrepLeadHours: number;
  meetingFollowUpDays: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  workdaysOnly: boolean;
};

export type RuleOverride = { isEnabled: boolean; delayDays: number | null; priority: number | null };

export type EngineConfig = {
  thresholds: EngineThresholds;
  overrides: Record<string, RuleOverride>;
};

/**
 * A rule of the catalogue. Rules are data: they are evaluated in order and the
 * first match wins, so the catalogue reads like a decision table rather than a
 * chain of conditions.
 */
export type Rule = {
  key: string;
  /** Shown in the rule settings screen. */
  label: string;
  appliesTo: SubjectKind[];
  evaluate: (subject: EngineSubject, config: EngineThresholds, now: Date) => NextActionProposal | null;
};

/** One transparent signal behind a momentum value. */
export type MomentumSignal = { label: string; weight: number };

export type MomentumResult = { momentum: Momentum; signals: MomentumSignal[]; score: number };
