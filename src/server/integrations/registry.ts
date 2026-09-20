import type { IntegrationProvider } from "@/generated/prisma/enums";

/**
 * Integration catalogue.
 *
 * `implemented: false` means exactly that — the adapter contract exists and the
 * UI shows the integration as not connectable yet. Nothing here pretends to be
 * wired up. Adding a provider means implementing its adapter and flipping the
 * flag; no other part of the product needs to change.
 */
export type IntegrationDescriptor = {
  provider: IntegrationProvider;
  name: string;
  category: "E-Mail" | "Kalender" | "Kommunikation" | "Zahlungen" | "Automatisierung";
  summary: string;
  capabilities: string[];
  /** What an administrator must supply before this can be connected. */
  requires: string[];
  implemented: boolean;
  /** Per-user connection (e.g. a mailbox) rather than per-organization. */
  perUser: boolean;
};

export const INTEGRATIONS: IntegrationDescriptor[] = [
  {
    provider: "SMTP",
    name: "SMTP-Postausgang",
    category: "E-Mail",
    summary: "Versendet CRM-E-Mails über einen eigenen SMTP-Server.",
    capabilities: ["E-Mails aus dem CRM senden", "Versand als Aktivität protokollieren", "Einladungen zustellen"],
    requires: ["SMTP-Host, Port, Benutzername und Passwort", "Absenderadresse"],
    implemented: true,
    perUser: false,
  },
  {
    provider: "GOOGLE",
    name: "Google Workspace",
    category: "E-Mail",
    summary: "Verbindet Gmail und Google Kalender mit dem CRM.",
    capabilities: ["E-Mail-Verlauf zuordnen", "Termine synchronisieren"],
    requires: ["Google Cloud OAuth-Client (Client-ID und Secret)", "Verifizierte Domain"],
    implemented: false,
    perUser: true,
  },
  {
    provider: "MICROSOFT",
    name: "Microsoft 365",
    category: "E-Mail",
    summary: "Verbindet Outlook-Postfächer und Kalender mit dem CRM.",
    capabilities: ["E-Mail-Verlauf zuordnen", "Termine synchronisieren"],
    requires: ["Entra-ID-App-Registrierung", "Delegierte Berechtigungen"],
    implemented: false,
    perUser: true,
  },
  {
    provider: "SLACK",
    name: "Slack",
    category: "Kommunikation",
    summary: "Benachrichtigt Vertriebskanäle über CRM-Ereignisse.",
    capabilities: ["Deal-Benachrichtigungen in Kanäle senden"],
    requires: ["Slack-App mit Incoming-Webhook oder Bot-Token"],
    implemented: false,
    perUser: false,
  },
  {
    provider: "STRIPE",
    name: "Stripe",
    category: "Zahlungen",
    summary: "Verknüpft Zahlungen und Abonnements mit Deals.",
    capabilities: ["Zahlungsstatus am Deal anzeigen"],
    requires: ["Stripe-API-Schlüssel"],
    implemented: false,
    perUser: false,
  },
  {
    provider: "CALENDLY",
    name: "Calendly",
    category: "Kalender",
    summary: "Übernimmt gebuchte Termine als CRM-Meetings.",
    capabilities: ["Buchungen als Meeting anlegen"],
    requires: ["Calendly-API-Token"],
    implemented: false,
    perUser: true,
  },
  {
    provider: "ZAPIER",
    name: "Zapier / Make",
    category: "Automatisierung",
    summary: "Verbindet OKUN CRM über signierte Webhooks mit externen Tools.",
    capabilities: ["Ausgehende Webhooks für CRM-Events", "HMAC-signierte Zustellung mit Wiederholungen"],
    requires: ["Ziel-URL im Bereich Webhooks hinterlegen"],
    // Outgoing webhooks are fully implemented — see src/server/services/webhooks.ts.
    implemented: true,
    perUser: false,
  },
];

export function findIntegration(provider: IntegrationProvider): IntegrationDescriptor | undefined {
  return INTEGRATIONS.find((integration) => integration.provider === provider);
}
