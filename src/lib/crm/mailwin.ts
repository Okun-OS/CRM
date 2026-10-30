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
] as const;

export type MailwinWebhookType = (typeof MAILWIN_WEBHOOK_EVENTS)[number]["type"];
export type MailwinWebhookSource = (typeof MAILWIN_WEBHOOK_EVENTS)[number]["source"];

export function mailwinTypeFor(source: string): MailwinWebhookType | null {
  return MAILWIN_WEBHOOK_EVENTS.find((event) => event.source === source)?.type ?? null;
}
