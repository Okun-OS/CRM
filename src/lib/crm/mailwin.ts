/**
 * Mailwin Connect — Vokabular, das Server und Oberfläche teilen.
 *
 * Frei von Datenbank-Importen, damit die Einstellungsseite (Client Component)
 * dieselben Ereignisnamen und Pfade anzeigt, die der Server verwendet.
 */

/** Der einzige Scope eines Mailwin-Schlüssels. Er öffnet nur die Mailwin Connect API. */
export const MAILWIN_SCOPE = "mailwin:connect";

/** Basis-Pfad der Schnittstelle, relativ zur APP_URL. */
export const MAILWIN_API_BASE_PATH = "/api/mailwin/v1";

export const MAILWIN_DEFAULT_WEBHOOK_URL = "https://okun-mailwin.com/api/integrations/okun-crm/webhook";

/**
 * Ereignisse an Mailwin und ihre Quelle im CRM.
 *
 * Mailwin spricht von „Leads“; im CRM ist das der Deal (Pipeline, Phase, Wert,
 * gewonnen/verloren). Die Webhooks tragen deshalb Mailwins Namen, entstehen
 * aber aus den Deal-Ereignissen des CRM.
 */
export const MAILWIN_WEBHOOK_EVENTS = [
  { type: "lead.stage_changed", source: "deal.stage_changed", label: "Lead wechselt die Phase" },
  { type: "lead.won", source: "deal.won", label: "Lead gewonnen" },
  { type: "lead.lost", source: "deal.lost", label: "Lead verloren" },
  { type: "contact.updated", source: "contact.updated", label: "Kontakt geändert" },
  {
    type: "lead.next_action_changed",
    source: "deal.next_action_changed",
    label: "Neue nächste Aktion (z. B. „Angebot nachfassen“ fällig am …)",
  },
] as const;

export type MailwinWebhookType = (typeof MAILWIN_WEBHOOK_EVENTS)[number]["type"];
export type MailwinWebhookSource = (typeof MAILWIN_WEBHOOK_EVENTS)[number]["source"];

export function mailwinTypeFor(source: string): MailwinWebhookType | null {
  return MAILWIN_WEBHOOK_EVENTS.find((event) => event.source === source)?.type ?? null;
}

/**
 * Signale, die Mailwin zu einem Lead melden kann (POST /leads/{id}/signals).
 * Mailwin meldet, was es erkannt hat; was daraus folgt, entscheidet das CRM.
 */
export const MAILWIN_SIGNALS = [
  "offer_sent",
  "offer_accepted",
  "offer_declined",
  "meeting_requested",
  "meeting_booked",
  "question",
  "out_of_office",
  "contract_sent",
  "contract_accepted",
] as const;

export type MailwinSignal = (typeof MAILWIN_SIGNALS)[number];

/** Signale, die einen Lead in eine Phase vorrücken können. */
export const MAILWIN_STAGE_SIGNALS = ["offer_sent", "meeting_booked", "contract_sent"] as const;
export type MailwinStageSignal = (typeof MAILWIN_STAGE_SIGNALS)[number];

export const MAILWIN_SIGNAL_LABELS: Record<MailwinSignal, string> = {
  offer_sent: "Angebot gesendet",
  offer_accepted: "Angebot angenommen",
  offer_declined: "Angebot abgelehnt",
  meeting_requested: "Terminwunsch",
  meeting_booked: "Termin vereinbart",
  question: "Rückfrage",
  out_of_office: "Abwesenheitsnotiz",
  contract_sent: "Vertrag gesendet",
  contract_accepted: "Vertrag angenommen",
};
