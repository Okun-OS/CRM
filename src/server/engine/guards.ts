import type { EngineSubject, EngineThresholds } from "./types";

/**
 * Safety checks re-evaluated immediately before an automation runs.
 *
 * The point is simple: between scheduling and execution the world moves. The
 * customer answers, a meeting is booked, the deal closes. Nothing may go out
 * that has become wrong in the meantime — an automated message that ignores an
 * answer already given is worse than no automation at all.
 */
export type AutomationGuard =
  | { kind: "record_open" }
  | { kind: "no_customer_response_since"; since: string }
  | { kind: "no_outbound_since"; since: string }
  | { kind: "no_meeting_scheduled" }
  | { kind: "automation_not_paused" }
  | { kind: "within_working_hours" };

export type GuardOutcome =
  | { result: "ok" }
  | { result: "skip"; reason: string }
  | { result: "defer"; until: Date; reason: string };

const HOUR = 60 * 60 * 1000;

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Next moment that is inside the configured sending window. */
export function nextSendingSlot(now: Date, config: EngineThresholds): Date {
  const candidate = new Date(now);
  for (let step = 0; step < 24 * 14; step += 1) {
    const hour = candidate.getHours();
    const day = candidate.getDay();
    const quietWraps = config.quietHoursStart > config.quietHoursEnd;
    const inQuietHours = quietWraps
      ? hour >= config.quietHoursStart || hour < config.quietHoursEnd
      : hour >= config.quietHoursStart && hour < config.quietHoursEnd;
    const isWeekend = day === 0 || day === 6;

    if (!inQuietHours && !(config.workdaysOnly && isWeekend)) return candidate;
    candidate.setTime(candidate.getTime() + HOUR);
    candidate.setMinutes(0, 0, 0);
  }
  return candidate;
}

export function parseGuards(value: unknown): AutomationGuard[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is AutomationGuard => {
    return typeof entry === "object" && entry !== null && typeof (entry as { kind?: unknown }).kind === "string";
  });
}

export function evaluateGuards(
  guards: AutomationGuard[],
  subject: EngineSubject,
  config: EngineThresholds,
  now: Date,
): GuardOutcome {
  for (const guard of guards) {
    switch (guard.kind) {
      case "record_open":
        if (!subject.isOpen) {
          return { result: "skip", reason: "Der Datensatz ist abgeschlossen." };
        }
        break;

      case "no_customer_response_since": {
        const since = parseDate(guard.since);
        if (since && subject.lastCustomerResponseAt && subject.lastCustomerResponseAt.getTime() > since.getTime()) {
          return { result: "skip", reason: "Der Kunde hat inzwischen geantwortet." };
        }
        break;
      }

      case "no_outbound_since": {
        const since = parseDate(guard.since);
        if (since && subject.lastOutboundAt && subject.lastOutboundAt.getTime() > since.getTime()) {
          return { result: "skip", reason: "Es wurde inzwischen bereits nachgefasst." };
        }
        break;
      }

      case "no_meeting_scheduled":
        if (subject.nextMeetingAt && subject.nextMeetingAt.getTime() > now.getTime()) {
          return { result: "skip", reason: "Es ist bereits ein Termin vereinbart." };
        }
        break;

      case "automation_not_paused":
        if (subject.automationPausedUntil && subject.automationPausedUntil.getTime() > now.getTime()) {
          return {
            result: "defer",
            until: subject.automationPausedUntil,
            reason: "Die Automation ist für diesen Datensatz pausiert.",
          };
        }
        break;

      case "within_working_hours": {
        const slot = nextSendingSlot(now, config);
        if (slot.getTime() > now.getTime()) {
          return { result: "defer", until: slot, reason: "Außerhalb der konfigurierten Versandzeiten." };
        }
        break;
      }
    }
  }

  return { result: "ok" };
}

/** The guard set every outbound automation carries by default. */
export function defaultOutboundGuards(scheduledAt: Date): AutomationGuard[] {
  return [
    { kind: "record_open" },
    { kind: "automation_not_paused" },
    { kind: "no_customer_response_since", since: scheduledAt.toISOString() },
    { kind: "no_meeting_scheduled" },
    { kind: "within_working_hours" },
  ];
}
