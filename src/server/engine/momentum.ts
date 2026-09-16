import type { EngineSubject, EngineThresholds, MomentumResult, MomentumSignal } from "./types";

/**
 * Sales momentum.
 *
 * Deliberately *not* a probability and not a model output: it is a sum of
 * named signals, and every signal that contributed is stored with the record
 * so the user can read why the value is what it is.
 */
const DAY = 24 * 60 * 60 * 1000;

function daysSince(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / DAY);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function computeMomentum(subject: EngineSubject, config: EngineThresholds, now: Date): MomentumResult {
  const signals: MomentumSignal[] = [];

  const lastActivity = subject.lastActivityAt ?? subject.createdAt;
  const idleDays = daysSince(lastActivity, now);

  if (subject.lastCustomerResponseAt) {
    const responseAge = daysSince(subject.lastCustomerResponseAt, now);
    if (responseAge <= 7) {
      signals.push({ label: `Kunde hat vor ${responseAge} Tag(en) geantwortet`, weight: 2 });
    } else if (responseAge <= config.stagnationAfterDays) {
      signals.push({ label: `Letzte Kundenantwort am ${formatDate(subject.lastCustomerResponseAt)}`, weight: 1 });
    }
  } else if (subject.lastOutboundAt) {
    signals.push({ label: "Noch keine Antwort des Kunden", weight: -1 });
  }

  if (subject.nextMeetingAt && subject.nextMeetingAt.getTime() > now.getTime()) {
    signals.push({ label: `Termin am ${formatDate(subject.nextMeetingAt)} geplant`, weight: 2 });
  }

  if (subject.meetingCompletedAt && daysSince(subject.meetingCompletedAt, now) <= 14) {
    signals.push({ label: `Termin am ${formatDate(subject.meetingCompletedAt)} stattgefunden`, weight: 1 });
  }

  if (subject.offerSentAt) {
    const offerAge = daysSince(subject.offerSentAt, now);
    if (offerAge <= config.offerChaseAfterDays) {
      signals.push({ label: `Angebot am ${formatDate(subject.offerSentAt)} gesendet`, weight: 2 });
    } else {
      signals.push({ label: `Angebot seit ${offerAge} Tagen ohne Rückmeldung`, weight: -2 });
    }
  }

  if (idleDays >= config.stagnationAfterDays) {
    signals.push({ label: `Seit ${idleDays} Tagen keine Aktivität`, weight: -3 });
  } else if (idleDays <= 3) {
    signals.push({ label: "Aktivität in den letzten 3 Tagen", weight: 1 });
  }

  if (subject.expectedCloseDate && subject.expectedCloseDate.getTime() < now.getTime()) {
    signals.push({ label: `Geplanter Abschluss am ${formatDate(subject.expectedCloseDate)} überschritten`, weight: -2 });
  }

  if (signals.length === 0) {
    signals.push({ label: "Noch keine auswertbaren Signale", weight: 0 });
  }

  const score = signals.reduce((sum, signal) => sum + signal.weight, 0);

  // Stagnation is a fact, not a score: no activity for the configured period
  // always means STALLED, whatever else happened before.
  const momentum =
    idleDays >= config.stagnationAfterDays ? "STALLED" : score >= 3 ? "HIGH" : score >= 1 ? "MEDIUM" : "LOW";

  return { momentum, signals, score };
}
