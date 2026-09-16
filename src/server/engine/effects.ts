import type { ActivityDirection, ActivityType, AutomationType, CrmEventType } from "@/generated/prisma/enums";

/**
 * What each business event means for a record.
 *
 * This table is the "zero administration" part of the product: the user does
 * the work (sends a mail, holds a meeting, gets a reply), and the timeline,
 * the waiting state and the running automations follow from it — nobody has to
 * maintain them by hand. New behaviour is a new row here, not another branch
 * somewhere in a service.
 */
export type EventPatch = {
  lastActivityAt?: Date;
  lastOutboundAt?: Date;
  lastCustomerResponseAt?: Date;
  nextMeetingAt?: Date | null;
  /** Deal-only fields are ignored for leads. */
  offerSentAt?: Date | null;
  stageEnteredAt?: Date;
};

export type EventEffect = {
  /** Timeline entry written automatically. */
  activity?: {
    type: ActivityType;
    direction?: ActivityDirection;
    subject: (payload: Record<string, unknown>) => string;
  };
  /** Denormalised fields kept in sync so lists and rules stay fast. */
  patch?: (occurredAt: Date, payload: Record<string, unknown>) => EventPatch;
  /** Pending automations this event makes pointless, with the reason shown to the user. */
  cancels?: { reason: string; types?: AutomationType[] };
  /** Closes the tasks the engine created for this record — reality moved on. */
  closesEngineTasks?: string;
};

function text(payload: Record<string, unknown>, key: string, fallback: string): string {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

const CUSTOMER_ANSWERED = "Der Kunde hat geantwortet.";

export const EVENT_EFFECTS: Partial<Record<CrmEventType, EventEffect>> = {
  EMAIL_SENT: {
    activity: {
      type: "EMAIL",
      direction: "OUTBOUND",
      subject: (payload) => `E-Mail gesendet: ${text(payload, "subject", "ohne Betreff")}`,
    },
    patch: (occurredAt) => ({ lastActivityAt: occurredAt, lastOutboundAt: occurredAt }),
  },
  EMAIL_RECEIVED: {
    activity: {
      type: "EMAIL",
      direction: "INBOUND",
      subject: (payload) => `E-Mail empfangen: ${text(payload, "subject", "ohne Betreff")}`,
    },
    patch: (occurredAt) => ({ lastActivityAt: occurredAt, lastCustomerResponseAt: occurredAt }),
    cancels: { reason: CUSTOMER_ANSWERED },
    closesEngineTasks: CUSTOMER_ANSWERED,
  },
  CUSTOMER_REPLIED: {
    activity: { type: "SYSTEM", direction: "INBOUND", subject: () => "Antwort des Kunden erkannt" },
    patch: (occurredAt) => ({ lastActivityAt: occurredAt, lastCustomerResponseAt: occurredAt }),
    cancels: { reason: CUSTOMER_ANSWERED },
    closesEngineTasks: CUSTOMER_ANSWERED,
  },
  CALL_LOGGED: {
    activity: {
      type: "CALL",
      subject: (payload) => `Anruf: ${text(payload, "outcome", "erfasst")}`,
    },
    patch: (occurredAt) => ({ lastActivityAt: occurredAt, lastOutboundAt: occurredAt }),
  },
  NOTE_ADDED: {
    activity: { type: "NOTE", subject: (payload) => text(payload, "title", "Notiz hinzugefügt") },
    patch: (occurredAt) => ({ lastActivityAt: occurredAt }),
  },
  MEETING_BOOKED: {
    activity: {
      type: "MEETING",
      subject: (payload) => `Termin gebucht: ${text(payload, "title", "Termin")}`,
    },
    patch: (occurredAt, payload) => ({
      lastActivityAt: occurredAt,
      nextMeetingAt: typeof payload.startAt === "string" ? new Date(payload.startAt) : undefined,
    }),
    cancels: { reason: "Ein Termin wurde vereinbart." },
    closesEngineTasks: "Ein Termin wurde vereinbart.",
  },
  MEETING_COMPLETED: {
    activity: {
      type: "MEETING",
      subject: (payload) => `Termin stattgefunden: ${text(payload, "title", "Termin")}`,
    },
    patch: (occurredAt) => ({ lastActivityAt: occurredAt, nextMeetingAt: null }),
  },
  MEETING_CANCELLED: {
    activity: {
      type: "MEETING",
      subject: (payload) => `Termin abgesagt: ${text(payload, "title", "Termin")}`,
    },
    patch: (occurredAt) => ({ lastActivityAt: occurredAt, nextMeetingAt: null }),
  },
  OFFER_CREATED: {
    activity: { type: "SYSTEM", subject: (payload) => `Angebot erstellt: ${text(payload, "reference", "Angebot")}` },
    patch: (occurredAt) => ({ lastActivityAt: occurredAt }),
  },
  OFFER_SENT: {
    activity: {
      type: "SYSTEM",
      direction: "OUTBOUND",
      subject: (payload) => `Angebot gesendet: ${text(payload, "reference", "Angebot")}`,
    },
    patch: (occurredAt) => ({ lastActivityAt: occurredAt, lastOutboundAt: occurredAt, offerSentAt: occurredAt }),
  },
  OFFER_VIEWED: {
    activity: { type: "SYSTEM", direction: "INBOUND", subject: () => "Angebot wurde vom Kunden geöffnet" },
    patch: (occurredAt) => ({ lastActivityAt: occurredAt }),
  },
  CONTRACT_SENT: {
    activity: { type: "SYSTEM", direction: "OUTBOUND", subject: () => "Vertrag gesendet" },
    patch: (occurredAt) => ({ lastActivityAt: occurredAt, lastOutboundAt: occurredAt }),
  },
  CONTRACT_ACCEPTED: {
    activity: { type: "SYSTEM", direction: "INBOUND", subject: () => "Vertrag angenommen" },
    patch: (occurredAt) => ({ lastActivityAt: occurredAt, lastCustomerResponseAt: occurredAt }),
    cancels: { reason: "Der Vertrag wurde angenommen." },
    closesEngineTasks: "Der Vertrag wurde angenommen.",
  },
  PAYMENT_RECEIVED: {
    activity: { type: "SYSTEM", subject: (payload) => `Zahlung eingegangen${payload.amount ? `: ${String(payload.amount)}` : ""}` },
    patch: (occurredAt) => ({ lastActivityAt: occurredAt, lastCustomerResponseAt: occurredAt }),
  },
  DEAL_STAGE_CHANGED: {
    patch: (occurredAt) => ({ lastActivityAt: occurredAt, stageEnteredAt: occurredAt }),
  },
  DEAL_WON: {
    cancels: { reason: "Der Deal wurde gewonnen." },
    closesEngineTasks: "Der Deal wurde gewonnen.",
  },
  DEAL_LOST: {
    cancels: { reason: "Der Deal wurde verloren." },
    closesEngineTasks: "Der Deal wurde verloren.",
  },
  LEAD_STATUS_CHANGED: {
    patch: (occurredAt) => ({ lastActivityAt: occurredAt }),
  },
  RECALL_REQUESTED: {
    activity: {
      type: "SYSTEM",
      subject: (payload) => `Wiedervorlage gesetzt${payload.scheduledFor ? ` auf ${String(payload.scheduledFor).slice(0, 10)}` : ""}`,
    },
  },
  TASK_COMPLETED: {
    patch: (occurredAt) => ({ lastActivityAt: occurredAt }),
  },
};
