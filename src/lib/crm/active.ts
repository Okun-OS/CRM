import type {
  AutomationStatus,
  AutomationType,
  CrmEventType,
  Momentum,
  NextActionStatus,
  NextActionType,
  OperationalState,
} from "@/generated/prisma/enums";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * Vocabulary of the Active CRM layer.
 *
 * Free of database imports on purpose: the board, the action center and the
 * record headers render these labels in client components.
 */

export const OPERATIONAL_STATE_LABELS: Record<OperationalState, string> = {
  WAITING_FOR_US: "Wir sind am Zug",
  WAITING_FOR_CUSTOMER: "Warten auf Kunden",
  SCHEDULED: "Termin geplant",
  NO_NEXT_ACTION: "Keine nächste Aktion definiert",
  CLOSED: "Abgeschlossen",
};

/** Tone used by badges; maps to the design tokens, not to raw colours. */
export const OPERATIONAL_STATE_TONE: Record<OperationalState, BadgeTone> = {
  WAITING_FOR_US: "warning",
  WAITING_FOR_CUSTOMER: "brand",
  SCHEDULED: "accent",
  NO_NEXT_ACTION: "danger",
  CLOSED: "neutral",
};

export const NEXT_ACTION_LABELS: Record<NextActionType, string> = {
  CONTACT_LEAD: "Lead kontaktieren",
  QUALIFY_LEAD: "Lead qualifizieren",
  FOLLOW_UP: "Follow-up senden",
  CALL: "Anrufen",
  SCHEDULE_MEETING: "Termin vereinbaren",
  CONFIRM_MEETING: "Termin bestätigen",
  PREPARE_MEETING: "Termin vorbereiten",
  CREATE_OFFER: "Angebot erstellen",
  SEND_OFFER: "Angebot senden",
  CHASE_OFFER: "Angebot nachfassen",
  GET_DECISION: "Entscheidung einholen",
  PREPARE_CONTRACT: "Vertrag vorbereiten",
  REACTIVATE: "Reaktivieren",
  DEFINE_NEXT_STEP: "Nächsten Schritt festlegen",
  CUSTOM: "Eigene Aktion",
};

export const NEXT_ACTION_STATUS_LABELS: Record<NextActionStatus, string> = {
  OPEN: "Offen",
  DONE: "Erledigt",
  DISMISSED: "Verworfen",
  SUPERSEDED: "Ersetzt",
  SNOOZED: "Zurückgestellt",
};

export const MOMENTUM_LABELS: Record<Momentum, string> = {
  HIGH: "Hoch",
  MEDIUM: "Mittel",
  LOW: "Niedrig",
  STALLED: "Stagniert",
};

export const MOMENTUM_TONE: Record<Momentum, BadgeTone> = {
  HIGH: "success",
  MEDIUM: "brand",
  LOW: "warning",
  STALLED: "danger",
};

export const AUTOMATION_TYPE_LABELS: Record<AutomationType, string> = {
  FOLLOW_UP_EMAIL: "Follow-up E-Mail",
  FOLLOW_UP_TASK: "Follow-up Aufgabe",
  RECALL: "Wiedervorlage",
  REMINDER: "Erinnerung",
};

export const AUTOMATION_STATUS_LABELS: Record<AutomationStatus, string> = {
  PENDING: "Geplant",
  EXECUTED: "Ausgeführt",
  SKIPPED: "Übersprungen",
  CANCELLED: "Abgebrochen",
  FAILED: "Fehlgeschlagen",
};

export const CRM_EVENT_LABELS: Record<CrmEventType, string> = {
  CONTACT_CREATED: "Kontakt angelegt",
  LEAD_CREATED: "Lead angelegt",
  LEAD_STATUS_CHANGED: "Lead-Status geändert",
  DEAL_CREATED: "Deal angelegt",
  DEAL_STAGE_CHANGED: "Stage geändert",
  DEAL_UPDATED: "Deal aktualisiert",
  EMAIL_SENT: "E-Mail gesendet",
  EMAIL_RECEIVED: "E-Mail empfangen",
  CALL_LOGGED: "Anruf erfasst",
  NOTE_ADDED: "Notiz hinzugefügt",
  MEETING_BOOKED: "Termin gebucht",
  MEETING_COMPLETED: "Termin stattgefunden",
  MEETING_CANCELLED: "Termin abgesagt",
  OFFER_CREATED: "Angebot erstellt",
  OFFER_SENT: "Angebot gesendet",
  OFFER_VIEWED: "Angebot angesehen",
  CUSTOMER_REPLIED: "Kunde hat geantwortet",
  TASK_CREATED: "Aufgabe erstellt",
  TASK_COMPLETED: "Aufgabe erledigt",
  CONTRACT_SENT: "Vertrag gesendet",
  CONTRACT_ACCEPTED: "Vertrag angenommen",
  PAYMENT_RECEIVED: "Zahlung eingegangen",
  DEAL_WON: "Deal gewonnen",
  DEAL_LOST: "Deal verloren",
  NEXT_ACTION_COMPLETED: "Nächste Aktion erledigt",
  NEXT_ACTION_SNOOZED: "Nächste Aktion zurückgestellt",
  AUTOMATION_EXECUTED: "Automation ausgeführt",
  AUTOMATION_CANCELLED: "Automation abgebrochen",
  RECALL_REQUESTED: "Wiedervorlage gesetzt",
};

/** The buckets of the action center, in the order they are worked through. */
export const ACTION_BUCKETS = [
  { key: "overdue", label: "Überfällig", description: "Fällige Aktionen aus der Vergangenheit." },
  { key: "today", label: "Heute", description: "Heute fällige Aktionen." },
  { key: "high_priority", label: "Hohe Priorität", description: "Aktionen mit hoher Priorität." },
  { key: "follow_ups", label: "Follow-ups", description: "Nachfassen bei offenen Nachrichten und Angeboten." },
  { key: "without_next_action", label: "Ohne nächste Aktion", description: "Offene Deals, für die kein nächster Schritt definiert ist." },
  { key: "new_leads", label: "Neue Leads", description: "Leads, die noch nicht kontaktiert wurden." },
  { key: "waiting_for_us", label: "Wartet auf mich", description: "Der Kunde hat geantwortet – wir sind am Zug." },
  { key: "waiting_for_customer", label: "Wartet auf Kunden", description: "Nachgefasst, Antwort steht aus." },
] as const;

export type ActionBucketKey = (typeof ACTION_BUCKETS)[number]["key"];

export const ACTION_BUCKET_LABELS = Object.fromEntries(
  ACTION_BUCKETS.map((bucket) => [bucket.key, bucket.label]),
) as Record<ActionBucketKey, string>;

/** Priority bands used by the rules; a rule never invents a score outside these. */
export const PRIORITY = {
  CRITICAL: 90,
  HIGH: 75,
  NORMAL: 50,
  LOW: 25,
} as const;
